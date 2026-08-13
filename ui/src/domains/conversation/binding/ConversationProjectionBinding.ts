/** Owns an opened Conversation and its minimal projection for one React consumer. */
import type {
  ConversationHandle,
  ConversationSystemControl,
  Logger,
  NovelApiClient,
  Receipt,
} from "@novel/core";
import {
  ConversationProjection,
  noopLogger,
  type ConversationProjectionSnapshot,
} from "@novel/core/client";
import {
  CONVERSATION_PROJECTION_BINDING_STATE,
  type ConversationProjectionBindingListener,
  type ConversationProjectionBindingSnapshot,
  type ConversationProjectionBindingState,
} from "./ConversationProjectionBindingTypes.js";

export interface ConversationProjectionBindingOptions {
  readonly api: NovelApiClient;
  readonly conversationId: string;
  readonly logger?: Logger;
}

export class ConversationProjectionBinding {
  readonly conversationId: string;

  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  private readonly listeners = new Set<ConversationProjectionBindingListener>();
  private state: ConversationProjectionBindingState =
    CONVERSATION_PROJECTION_BINDING_STATE.idle;
  private snapshot: ConversationProjectionBindingSnapshot;
  private generation = 0;
  private handle?: ConversationHandle;
  private projection?: ConversationProjection;
  private unsubscribeProjection?: () => void;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;

  constructor(options: ConversationProjectionBindingOptions) {
    this.api = options.api;
    this.conversationId = requireConversationId(options.conversationId);
    this.logger = (options.logger ?? noopLogger).child({
      component: "conversation_projection_binding",
      conversationId: this.conversationId,
    });
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot(): ConversationProjectionBindingSnapshot {
    return this.snapshot;
  }

  subscribe(listener: ConversationProjectionBindingListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): Promise<void> {
    if (this.state === CONVERSATION_PROJECTION_BINDING_STATE.active) {
      return Promise.resolve();
    }
    if (this.startPromise !== undefined) return this.startPromise;
    if (this.state !== CONVERSATION_PROJECTION_BINDING_STATE.idle) {
      return Promise.reject(new Error(`cannot start in state ${this.state}`));
    }
    const generation = ++this.generation;
    const tracked = this.startOnce(generation).finally(() => {
      if (this.startPromise === tracked) this.startPromise = undefined;
    });
    this.startPromise = tracked;
    return tracked;
  }

  /** 发送用户消息（turn lane）。 */
  sendUserMessage(text: string): Promise<Receipt> {
    return this.requireHandle().sendUserMessage({ text });
  }

  /** 发送系统控制（control lane：mode.set / stop / reload.config）。 */
  sendSystemControl(ctrl: ConversationSystemControl): Promise<Receipt> {
    return this.requireHandle().sendSystemControl(ctrl);
  }

  resume(): Promise<void> {
    return this.projection?.resume() ?? Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.stopOnce();
    return this.stopPromise;
  }

  private async startOnce(generation: number): Promise<void> {
    this.transition(CONVERSATION_PROJECTION_BINDING_STATE.opening);
    this.logger.info("novel_ui.conversation_projection.open_started", { generation });
    try {
      const handle = await this.api.conversations.open(this.conversationId);
      if (this.isSuperseded(generation)) {
        handle.dispose();
        return;
      }
      this.handle = handle;
      const projection = new ConversationProjection(handle, this.conversationId);
      this.projection = projection;
      this.unsubscribeProjection = projection.subscribe(() => this.publish());
      this.transition(CONVERSATION_PROJECTION_BINDING_STATE.active);
      await projection.start();
    } catch (error) {
      if (this.isSuperseded(generation)) return;
      this.transition(CONVERSATION_PROJECTION_BINDING_STATE.failed);
      this.logger.warn("novel_ui.conversation_projection.open_failed", {
        generation,
        errorName: getErrorName(error),
      });
      throw error;
    }
  }

  private async stopOnce(): Promise<void> {
    if (this.state === CONVERSATION_PROJECTION_BINDING_STATE.stopped) return;
    this.transition(CONVERSATION_PROJECTION_BINDING_STATE.stopping);
    this.generation += 1;
    const controller = this.projection;
    const startPromise = this.startPromise;
    await Promise.allSettled([
      ...(controller !== undefined ? [controller.stop()] : []),
      ...(startPromise !== undefined ? [startPromise] : []),
    ]);
    this.unsubscribeProjection?.();
    this.unsubscribeProjection = undefined;
    this.projection = undefined;
    const handle = this.handle;
    this.handle = undefined;
    handle?.dispose();
    this.transition(CONVERSATION_PROJECTION_BINDING_STATE.stopped);
    this.logger.info("novel_ui.conversation_projection.stopped");
  }

  private requireHandle(): ConversationHandle {
    if (this.state !== CONVERSATION_PROJECTION_BINDING_STATE.active || this.handle === undefined) {
      throw new Error(`conversation not active (state ${this.state})`);
    }
    return this.handle;
  }

  private isSuperseded(generation: number): boolean {
    return (
      generation !== this.generation ||
      this.state === CONVERSATION_PROJECTION_BINDING_STATE.stopping ||
      this.state === CONVERSATION_PROJECTION_BINDING_STATE.stopped
    );
  }

  private transition(state: ConversationProjectionBindingState): void {
    this.state = state;
    this.publish();
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.logger.error("novel_ui.conversation_projection.listener_failed", {
          errorName: getErrorName(error),
        });
      }
    }
  }

  private buildSnapshot(): ConversationProjectionBindingSnapshot {
    return Object.freeze({
      conversationId: this.conversationId,
      state: this.state,
      projection: this.projection?.getSnapshot() ?? emptyProjection(this.conversationId),
    });
  }
}

function emptyProjection(conversationId: string): ConversationProjectionSnapshot {
  return Object.freeze({
    conversationId,
    revision: 0,
    lastAppliedSequence: 0,
    state: "idle",
    timeline: Object.freeze([]),
  });
}

function requireConversationId(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Conversation Projection Binding id must not be blank");
  }
  return value;
}

function getErrorName(error: unknown): string {
  if (error === null || typeof error !== "object") return "UnknownError";
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && name.trim().length > 0 ? name : "UnknownError";
}
