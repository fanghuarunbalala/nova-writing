/** Owns an opened Conversation and Controller for one React projection consumer. */
import {
  ApiRemoteError,
  ApiTransportError,
  ConversationProjectionController,
  ConversationProjectionControllerStateError,
  ConversationProjectionStore,
  noopLogger,
  type Conversation,
  type ConversationProjectionControllerErrorSnapshot,
  type Logger,
  type NovelApiClient,
} from "@novel/core";
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
  private readonly store: ConversationProjectionStore;
  private readonly logger: Logger;
  private readonly listeners = new Set<ConversationProjectionBindingListener>();
  private state: ConversationProjectionBindingState =
    CONVERSATION_PROJECTION_BINDING_STATE.idle;
  private error?: ConversationProjectionControllerErrorSnapshot;
  private revision = 0;
  private snapshot: ConversationProjectionBindingSnapshot;
  private generation = 0;
  private conversation?: Conversation;
  private controller?: ConversationProjectionController;
  private unsubscribeController?: () => void;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;

  constructor(options: ConversationProjectionBindingOptions) {
    this.api = options.api;
    this.conversationId = requireConversationId(options.conversationId);
    this.logger = (options.logger ?? noopLogger).child({
      component: "conversation_projection_binding",
      conversationId: this.conversationId,
    });
    this.store = new ConversationProjectionStore({
      conversationId: this.conversationId,
      logger: this.logger,
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
      throw new ConversationProjectionControllerStateError("bind", this.state);
    }
    const generation = ++this.generation;
    const startPromise = this.startOnce(generation);
    const trackedPromise = startPromise.finally(() => {
      if (this.startPromise === trackedPromise) this.startPromise = undefined;
    });
    this.startPromise = trackedPromise;
    return trackedPromise;
  }

  resume(): Promise<void> {
    if (
      this.state !== CONVERSATION_PROJECTION_BINDING_STATE.active ||
      this.controller === undefined
    ) {
      throw new ConversationProjectionControllerStateError("resume", this.state);
    }
    return this.controller.resume();
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.stopOnce();
    return this.stopPromise;
  }

  private async startOnce(generation: number): Promise<void> {
    this.transition(CONVERSATION_PROJECTION_BINDING_STATE.opening);
    this.logger.info("novel_ui.conversation_projection.open_started", {
      generation,
    });
    try {
      const conversation = await this.api.conversations.open(this.conversationId);
      if (this.isSuperseded(generation)) {
        await conversation.close();
        return;
      }
      this.conversation = conversation;
      const controller = new ConversationProjectionController({
        conversation,
        store: this.store,
        logger: this.logger,
      });
      this.controller = controller;
      this.unsubscribeController = controller.subscribe(() => {
        this.publishSnapshot();
      });
      this.transition(CONVERSATION_PROJECTION_BINDING_STATE.active);
      await controller.start();
      this.logger.info("novel_ui.conversation_projection.open_completed", {
        generation,
        lastAppliedSequence: this.store.getSnapshot().lastAppliedSequence,
      });
    } catch (error) {
      if (this.isSuperseded(generation)) return;
      if (this.controller === undefined) {
        this.error = createBindingErrorSnapshot(error);
        this.transition(CONVERSATION_PROJECTION_BINDING_STATE.failed, false);
      }
      this.logger.warn("novel_ui.conversation_projection.open_failed", {
        generation,
        errorName: getErrorName(error),
        errorCode: createBindingErrorSnapshot(error).code,
      });
      throw error;
    }
  }

  private async stopOnce(): Promise<void> {
    if (this.state === CONVERSATION_PROJECTION_BINDING_STATE.stopped) return;
    this.transition(CONVERSATION_PROJECTION_BINDING_STATE.stopping);
    const generation = ++this.generation;
    const controller = this.controller;
    const startPromise = this.startPromise;
    const results = await Promise.allSettled([
      ...(controller !== undefined ? [controller.stop()] : []),
      ...(startPromise !== undefined ? [startPromise] : []),
    ]);
    this.unsubscribeController?.();
    this.unsubscribeController = undefined;
    const conversation = this.conversation;
    this.conversation = undefined;
    if (conversation !== undefined) {
      results.push(...(await Promise.allSettled([conversation.close()])));
    }
    this.transition(CONVERSATION_PROJECTION_BINDING_STATE.stopped);
    this.logger.info("novel_ui.conversation_projection.stopped", {
      generation,
      rejectedOperationCount: results.filter(
        (result) => result.status === "rejected",
      ).length,
      lastAppliedSequence: this.store.getSnapshot().lastAppliedSequence,
    });
  }

  private isSuperseded(generation: number): boolean {
    return (
      generation !== this.generation ||
      this.state === CONVERSATION_PROJECTION_BINDING_STATE.stopping ||
      this.state === CONVERSATION_PROJECTION_BINDING_STATE.stopped
    );
  }

  private transition(
    state: ConversationProjectionBindingState,
    clearError = true,
  ): void {
    this.state = state;
    if (clearError) this.error = undefined;
    this.publishSnapshot();
    this.logger.debug("novel_ui.conversation_projection.state_changed", {
      state,
      lastAppliedSequence: this.store.getSnapshot().lastAppliedSequence,
    });
  }

  private publishSnapshot(): void {
    this.revision += 1;
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
    const controllerSnapshot = this.controller?.getSnapshot();
    return Object.freeze({
      conversationId: this.conversationId,
      revision: this.revision,
      state: this.state,
      projection: this.store.getSnapshot(),
      ...(controllerSnapshot !== undefined
        ? { controller: controllerSnapshot }
        : {}),
      ...(this.error !== undefined
        ? { error: this.error }
        : controllerSnapshot?.error !== undefined
          ? { error: controllerSnapshot.error }
          : {}),
    });
  }
}

function requireConversationId(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Conversation Projection Binding id must not be blank");
  }
  return value;
}

function createBindingErrorSnapshot(
  error: unknown,
): ConversationProjectionControllerErrorSnapshot {
  if (error instanceof ApiTransportError) {
    return Object.freeze({
      code: error.code,
      retryable: error.retryable,
      category: "transport",
    });
  }
  if (error instanceof ApiRemoteError) {
    return Object.freeze({
      code: error.code,
      retryable: error.retryable,
      category: "remote",
    });
  }
  return Object.freeze({
    code: "NOVEL_UI_CONVERSATION_OPEN_FAILED",
    retryable: false,
    category: "unknown",
  });
}

function getErrorName(error: unknown): string {
  if (error === null || typeof error !== "object") return "UnknownError";
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && name.trim().length > 0
    ? name
    : "UnknownError";
}
