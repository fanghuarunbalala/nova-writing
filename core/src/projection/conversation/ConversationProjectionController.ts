/** Coordinates durable replay and live Event following into one Conversation Projection Store. */
import type { Conversation } from "../../conversation/Conversation.js";
import type { RuntimePresence } from "../../conversation/RuntimePresence.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { ConversationEventSubscription } from "../../storage/index.js";
import {
  ApiRemoteError,
  ApiTransportError,
  isApiTransportDisconnectedError,
} from "../../transport/index.js";
import {
  ConversationProjectionControllerStateError,
  ConversationProjectionError,
  ConversationProjectionReplayError,
  ConversationProjectionSubscriptionEndedError,
} from "./ConversationProjectionErrors.js";
import type { ConversationProjectionStore } from "./ConversationProjectionStore.js";
import {
  CONVERSATION_PROJECTION_CONTROLLER_STATE,
  type ConversationProjectionControllerErrorSnapshot,
  type ConversationProjectionControllerListener,
  type ConversationProjectionControllerSnapshot,
  type ConversationProjectionControllerState,
} from "./ConversationProjectionControllerTypes.js";

const DEFAULT_REPLAY_PAGE_SIZE = 200;
const MAX_REPLAY_PAGE_SIZE = 1_000;
const MAX_PROJECTION_RESUME_ATTEMPTS = 5;

export interface ConversationProjectionControllerOptions {
  readonly conversation: Conversation;
  readonly store: ConversationProjectionStore;
  readonly replayPageSize?: number;
  readonly logger?: Logger;
}

export class ConversationProjectionController {
  readonly conversationId: string;

  private readonly conversation: Conversation;
  private readonly store: ConversationProjectionStore;
  private readonly replayPageSize: number;
  private readonly logger: Logger;
  private readonly listeners = new Set<ConversationProjectionControllerListener>();
  private readonly unsubscribeStore: () => void;
  private controllerState: ConversationProjectionControllerState =
    CONVERSATION_PROJECTION_CONTROLLER_STATE.idle;
  private runtimePresence?: RuntimePresence;
  private error?: ConversationProjectionControllerErrorSnapshot;
  private revision = 0;
  private snapshot: ConversationProjectionControllerSnapshot;
  private generation = 0;
  private abortController?: AbortController;
  private subscription?: ConversationEventSubscription;
  private connectionPromise?: Promise<void>;
  private pumpPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private resumeAttempt = 0;
  private resumeTimer?: ReturnType<typeof setTimeout>;

  constructor(options: ConversationProjectionControllerOptions) {
    if (options.conversation.id !== options.store.conversationId) {
      throw new TypeError(
        "Conversation Projection Controller identities do not match",
      );
    }
    this.conversation = options.conversation;
    this.store = options.store;
    this.conversationId = options.conversation.id;
    this.replayPageSize = validateReplayPageSize(options.replayPageSize);
    this.logger = (options.logger ?? noopLogger).child({
      component: "conversation_projection_controller",
      conversationId: this.conversationId,
      replayPageSize: this.replayPageSize,
    });
    this.snapshot = this.buildSnapshot();
    this.unsubscribeStore = this.store.subscribe(() => {
      this.publishSnapshot();
    });
  }

  getSnapshot(): ConversationProjectionControllerSnapshot {
    return this.snapshot;
  }

  subscribe(listener: ConversationProjectionControllerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): Promise<void> {
    if (this.controllerState === CONVERSATION_PROJECTION_CONTROLLER_STATE.live) {
      return Promise.resolve();
    }
    if (this.connectionPromise !== undefined) return this.connectionPromise;
    if (this.controllerState !== CONVERSATION_PROJECTION_CONTROLLER_STATE.idle) {
      throw new ConversationProjectionControllerStateError(
        "start",
        this.controllerState,
      );
    }
    return this.beginConnection("start");
  }

  resume(): Promise<void> {
    if (this.connectionPromise !== undefined) return this.connectionPromise;
    if (
      this.controllerState !==
        CONVERSATION_PROJECTION_CONTROLLER_STATE.disconnected &&
      this.controllerState !== CONVERSATION_PROJECTION_CONTROLLER_STATE.failed
    ) {
      throw new ConversationProjectionControllerStateError(
        "resume",
        this.controllerState,
      );
    }
    return this.beginConnection("resume");
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.stopOnce();
    return this.stopPromise;
  }

  private beginConnection(operation: "start" | "resume"): Promise<void> {
    const generation = ++this.generation;
    const abortController = new AbortController();
    this.abortController = abortController;
    const connectionPromise = this.connect(
      operation,
      generation,
      abortController.signal,
    );
    const trackedPromise = connectionPromise.finally(() => {
      if (this.connectionPromise === trackedPromise) {
        this.connectionPromise = undefined;
      }
    });
    this.connectionPromise = trackedPromise;
    return trackedPromise;
  }

  private async connect(
    operation: "start" | "resume",
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    this.transition(CONVERSATION_PROJECTION_CONTROLLER_STATE.starting);
    this.logger.info("conversation.projection.connection_started", {
      operation,
      generation,
      lastAppliedSequence: this.store.getSnapshot().lastAppliedSequence,
    });
    try {
      const [conversationSnapshot, runtimePresence, composeState] =
        await Promise.all([
          this.conversation.getSnapshot(),
          this.conversation.getRuntimePresence(),
          this.conversation.getComposeState(),
        ]);
      this.assertConnectionActive(generation, signal);
      this.runtimePresence = Object.freeze({ ...runtimePresence });
      // 播种权威 mode(DB 元数据);裁剪/重连后回放缺失 mode.changed 事件时兜底。
      this.store.seedConversationMode(conversationSnapshot.metadata.mode);
      // 播种权威活跃 compose 阶段(DB compose_state 行);裁剪后回放缺失 compose
      // 事件时,徽标/状态仍正确。
      this.store.seedComposePhase(composeState?.phase);
      this.publishSnapshot();

      this.transition(CONVERSATION_PROJECTION_CONTROLLER_STATE.replaying);
      await this.replayThrough(
        conversationSnapshot.metadata.lastJournalSequence,
        generation,
        signal,
      );
      this.assertConnectionActive(generation, signal);

      const subscription = this.conversation.events.subscribe({
        start: {
          afterSequence: this.store.getSnapshot().lastAppliedSequence,
        },
        signal,
      });
      this.subscription = subscription;
      const postSubscribeSnapshot = await this.conversation.getSnapshot();
      this.assertConnectionActive(generation, signal);
      const postSubscribeWatermark =
        postSubscribeSnapshot.metadata.lastJournalSequence;
      if (postSubscribeWatermark > this.store.getSnapshot().lastAppliedSequence) {
        this.transition(CONVERSATION_PROJECTION_CONTROLLER_STATE.following);
        await this.drainThrough(
          subscription,
          postSubscribeWatermark,
          generation,
          signal,
        );
      }
      this.assertConnectionActive(generation, signal);
      this.transition(CONVERSATION_PROJECTION_CONTROLLER_STATE.live);
      this.resumeAttempt = 0;
      this.logger.info("conversation.projection.connection_live", {
        operation,
        generation,
        lastAppliedSequence: this.store.getSnapshot().lastAppliedSequence,
      });
      this.pumpPromise = this.pump(subscription, generation, signal).catch(
        async (error: unknown) => {
          await this.handlePumpFailure(error, subscription, generation, signal);
        },
      );
    } catch (error) {
      if (this.isConnectionSuperseded(generation, signal)) return;
      await this.closeSubscription();
      this.transitionFailure(error);
      throw error;
    }
  }

  private async replayThrough(
    targetSequence: number,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    while (this.store.getSnapshot().lastAppliedSequence < targetSequence) {
      this.assertConnectionActive(generation, signal);
      const afterSequence = this.store.getSnapshot().lastAppliedSequence;
      const page = await this.conversation.events.list({
        anchor: { afterSequence },
        throughSequence: targetSequence,
        limit: this.replayPageSize,
      });
      this.assertConnectionActive(generation, signal);
      if (page.highWatermark !== targetSequence || page.events.length === 0) {
        throw new ConversationProjectionReplayError();
      }
      this.store.applyMany(page.events);
      if (
        !page.hasNext &&
        this.store.getSnapshot().lastAppliedSequence < targetSequence
      ) {
        throw new ConversationProjectionReplayError();
      }
    }
  }

  private async drainThrough(
    subscription: ConversationEventSubscription,
    targetSequence: number,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    while (this.store.getSnapshot().lastAppliedSequence < targetSequence) {
      this.assertConnectionActive(generation, signal);
      const result = await subscription.next();
      this.assertConnectionActive(generation, signal);
      if (result.done) throw new ConversationProjectionSubscriptionEndedError();
      this.store.apply(result.value);
    }
  }

  private async pump(
    subscription: ConversationEventSubscription,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    while (!this.isConnectionSuperseded(generation, signal)) {
      const result = await subscription.next();
      if (this.isConnectionSuperseded(generation, signal)) return;
      if (result.done) throw new ConversationProjectionSubscriptionEndedError();
      this.store.apply(result.value);
    }
  }

  private async handlePumpFailure(
    error: unknown,
    subscription: ConversationEventSubscription,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.isConnectionSuperseded(generation, signal)) return;
    if (this.subscription === subscription) this.subscription = undefined;
    await Promise.allSettled([subscription.close()]);
    this.transitionFailure(error);
    if (!this.isConnectionSuperseded(generation, signal)) {
      this.scheduleAutoResume(generation, signal);
    }
  }

  private scheduleAutoResume(
    generation: number,
    signal: AbortSignal,
  ): void {
    if (
      this.controllerState !==
        CONVERSATION_PROJECTION_CONTROLLER_STATE.disconnected &&
      this.controllerState !== CONVERSATION_PROJECTION_CONTROLLER_STATE.failed
    ) {
      return;
    }
    if (this.resumeAttempt >= MAX_PROJECTION_RESUME_ATTEMPTS) {
      this.logger.warn("conversation.projection.auto_resume_limit_reached", {
        attempt: this.resumeAttempt,
      });
      return;
    }
    const delayMs = Math.min(1_000 * 2 ** this.resumeAttempt, 30_000);
    this.resumeAttempt += 1;
    this.logger.warn("conversation.projection.auto_resume_scheduled", {
      generation,
      attempt: this.resumeAttempt,
      delayMs,
      lastAppliedSequence: this.store.getSnapshot().lastAppliedSequence,
    });
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = undefined;
      if (this.isConnectionSuperseded(generation, signal)) return;
      void this.resume().catch((error: unknown) => {
        this.logger.warn("conversation.projection.auto_resume_failed", {
          errorName: getErrorName(error),
        });
      });
    }, delayMs);
  }

  private transitionFailure(error: unknown): void {
    const failure = createControllerErrorSnapshot(error);
    this.error = failure;
    const nextState = isApiTransportDisconnectedError(error)
      ? CONVERSATION_PROJECTION_CONTROLLER_STATE.disconnected
      : CONVERSATION_PROJECTION_CONTROLLER_STATE.failed;
    this.transition(nextState, false);
    this.logger.warn("conversation.projection.connection_failed", {
      state: nextState,
      errorCode: failure.code,
      errorCategory: failure.category,
      retryable: failure.retryable,
      errorName: getErrorName(error),
      lastAppliedSequence: this.store.getSnapshot().lastAppliedSequence,
    });
  }

  private async stopOnce(): Promise<void> {
    if (this.controllerState === CONVERSATION_PROJECTION_CONTROLLER_STATE.stopped) {
      return;
    }
    this.transition(CONVERSATION_PROJECTION_CONTROLLER_STATE.stopping);
    if (this.resumeTimer !== undefined) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = undefined;
    }
    const generation = ++this.generation;
    this.abortController?.abort();
    const subscription = this.subscription;
    this.subscription = undefined;
    const pending = [
      ...(subscription !== undefined ? [subscription.close()] : []),
      ...(this.connectionPromise !== undefined ? [this.connectionPromise] : []),
      ...(this.pumpPromise !== undefined ? [this.pumpPromise] : []),
    ];
    const results = await Promise.allSettled(pending);
    this.unsubscribeStore();
    this.transition(CONVERSATION_PROJECTION_CONTROLLER_STATE.stopped);
    const rejectedCount = results.filter(
      (result) => result.status === "rejected",
    ).length;
    this.logger.info("conversation.projection.controller_stopped", {
      generation,
      pendingOperationCount: pending.length,
      rejectedOperationCount: rejectedCount,
      lastAppliedSequence: this.store.getSnapshot().lastAppliedSequence,
    });
  }

  private closeSubscription(): Promise<void> {
    const subscription = this.subscription;
    this.subscription = undefined;
    return subscription?.close() ?? Promise.resolve();
  }

  private assertConnectionActive(generation: number, signal: AbortSignal): void {
    if (this.isConnectionSuperseded(generation, signal)) {
      throw new DOMException("Projection connection was aborted", "AbortError");
    }
  }

  private isConnectionSuperseded(
    generation: number,
    signal: AbortSignal,
  ): boolean {
    return (
      generation !== this.generation ||
      signal.aborted ||
      this.controllerState === CONVERSATION_PROJECTION_CONTROLLER_STATE.stopping ||
      this.controllerState === CONVERSATION_PROJECTION_CONTROLLER_STATE.stopped
    );
  }

  private transition(
    state: ConversationProjectionControllerState,
    clearError = true,
  ): void {
    this.controllerState = state;
    if (clearError) this.error = undefined;
    this.publishSnapshot();
    this.logger.debug("conversation.projection.state_changed", {
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
        this.logger.error("conversation.projection.controller_listener_failed", {
          errorName: getErrorName(error),
        });
      }
    }
  }

  private buildSnapshot(): ConversationProjectionControllerSnapshot {
    const projectedPresence = this.store.getSnapshot().runtimePresence;
    return Object.freeze({
      conversationId: this.conversationId,
      revision: this.revision,
      state: this.controllerState,
      lastAppliedSequence: this.store.getSnapshot().lastAppliedSequence,
      ...(projectedPresence !== undefined
        ? { runtimePresence: projectedPresence }
        : this.runtimePresence !== undefined
          ? { runtimePresence: this.runtimePresence }
          : {}),
      ...(this.error !== undefined ? { error: this.error } : {}),
    });
  }
}

function validateReplayPageSize(value: number | undefined): number {
  const pageSize = value ?? DEFAULT_REPLAY_PAGE_SIZE;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_REPLAY_PAGE_SIZE
  ) {
    throw new TypeError(
      `Conversation replay page size must be between 1 and ${MAX_REPLAY_PAGE_SIZE}`,
    );
  }
  return pageSize;
}

function createControllerErrorSnapshot(
  error: unknown,
): ConversationProjectionControllerErrorSnapshot {
  if (isApiTransportDisconnectedError(error)) {
    return Object.freeze({
      code: "API_TRANSPORT_DISCONNECTED",
      retryable: true,
      category: "transport",
    });
  }
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
  if (error instanceof ConversationProjectionError) {
    return Object.freeze({
      code: error.code,
      retryable: false,
      category: "projection",
    });
  }
  return Object.freeze({
    code: "UNKNOWN_CONTROLLER_FAILURE",
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
