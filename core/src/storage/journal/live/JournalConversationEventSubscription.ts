/** Pull-based Journal replay followed by one live Hub Subscription. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PersistedConversationEventSnapshot } from "../PersistedConversationEventSnapshot.js";
import type { ConversationEventCatchUpPager } from "./ConversationEventCatchUpPager.js";
import {
  ConversationEventSubscriptionAbortedError,
  ConversationEventSubscriptionConcurrentReadError,
  ConversationEventSubscriptionCursorAheadError,
  ConversationEventSubscriptionOverflowError,
} from "./ConversationEventLiveErrors.js";
import type {
  ConversationEventSubscription,
  ConversationEventSubscriptionStart,
  NormalizedConversationEventSubscriptionOptions,
} from "./ConversationEventSubscription.js";

interface ReadyConversationEventSubscriptionInitialization {
  status: "ready";
}

interface FailedConversationEventSubscriptionInitialization {
  status: "failed";
  error: Error;
}

type ConversationEventSubscriptionInitialization =
  | ReadyConversationEventSubscriptionInitialization
  | FailedConversationEventSubscriptionInitialization;

export interface JournalConversationEventSubscriptionOptions {
  options: NormalizedConversationEventSubscriptionOptions;
  liveSubscription: ConversationEventSubscription;
  pager: ConversationEventCatchUpPager;
  getHighWatermark: (conversationId: string) => Promise<number>;
  logger?: Logger;
  onTerminated?: (subscription: JournalConversationEventSubscription) => void;
}

type JournalConversationEventSubscriptionState =
  | "initializing"
  | "history"
  | "live"
  | "closed"
  | "failed";

export class JournalConversationEventSubscription
  implements ConversationEventSubscription
{
  readonly id: string;
  readonly conversationId: string;

  private readonly options: NormalizedConversationEventSubscriptionOptions;
  private readonly liveSubscription: ConversationEventSubscription;
  private readonly pager: ConversationEventCatchUpPager;
  private readonly getHighWatermark: (conversationId: string) => Promise<number>;
  private readonly logger: Logger;
  private readonly onTerminated?: (
    subscription: JournalConversationEventSubscription,
  ) => void;
  private readonly initialization: Promise<ConversationEventSubscriptionInitialization>;
  private subscriptionState: JournalConversationEventSubscriptionState = "initializing";
  private highWatermark = 0;
  private historyCursor = 0;
  private resumeSequence = 0;
  private historyEvents: readonly PersistedConversationEventSnapshot[] = [];
  private historyEventIndex = 0;
  private historyHasNext = false;
  private historyPageCount = 0;
  private skippedLiveDuplicateCount = 0;
  private failure?: Error;
  private readPending = false;
  private activeRead?: Promise<IteratorResult<PersistedConversationEventSnapshot>>;
  private closePromise?: Promise<void>;
  private terminationNotified = false;

  constructor(options: JournalConversationEventSubscriptionOptions) {
    this.options = options.options;
    this.liveSubscription = options.liveSubscription;
    this.id = this.liveSubscription.id;
    this.conversationId = this.options.conversationId;
    this.pager = options.pager;
    this.getHighWatermark = options.getHighWatermark;
    this.onTerminated = options.onTerminated;
    this.logger = (options.logger ?? noopLogger).child({
      component: "journal_conversation_event_subscription",
      subscriptionId: this.id,
      conversationId: this.conversationId,
    });
    this.options.signal?.addEventListener("abort", this.handleAbort, { once: true });
    this.initialization = this.initialize().then(
      () => ({ status: "ready" }) as const,
      (error: unknown) => {
        const normalized = this.normalizeFailure(error);
        this.terminateWithFailure(normalized);
        return { status: "failed", error: normalized } as const;
      },
    );
  }

  next(): Promise<IteratorResult<PersistedConversationEventSnapshot>> {
    if (this.readPending) {
      return Promise.reject(
        new ConversationEventSubscriptionConcurrentReadError(
          this.id,
          this.conversationId,
        ),
      );
    }
    if (this.subscriptionState === "closed") {
      return Promise.resolve({ done: true, value: undefined });
    }
    if (this.subscriptionState === "failed") {
      return Promise.reject(this.failure);
    }

    this.readPending = true;
    const operation = this.readNext().catch((error: unknown) => {
      const normalized = this.normalizeFailure(error);
      this.terminateWithFailure(normalized);
      throw normalized;
    });
    this.activeRead = operation;
    return operation.finally(() => {
      this.readPending = false;
      if (this.activeRead === operation) this.activeRead = undefined;
    });
  }

  async return(): Promise<IteratorResult<PersistedConversationEventSnapshot>> {
    await this.close();
    return { done: true, value: undefined };
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async initialize(): Promise<void> {
    this.throwIfAborted();
    const capturedHighWatermark = await this.getHighWatermark(this.conversationId);
    this.throwIfAborted();
    if (!Number.isSafeInteger(capturedHighWatermark) || capturedHighWatermark < 0) {
      throw new TypeError("Journal High Watermark must be a non-negative safe integer");
    }
    if (this.subscriptionState === "closed") return;
    if (this.subscriptionState === "failed") throw this.failure;

    this.highWatermark = capturedHighWatermark;
    this.historyCursor = this.getInitialCursor(this.options.start, capturedHighWatermark);
    this.resumeSequence = this.historyCursor;
    if (this.historyCursor < this.highWatermark) {
      this.subscriptionState = "history";
      this.logger.info("conversation_event.catch_up.started", {
        resumeSequence: this.resumeSequence,
        highWatermark: this.highWatermark,
        pageSize: this.pager.pageSize,
      });
    } else {
      this.enterLivePhase();
    }
  }

  private async readNext(): Promise<IteratorResult<PersistedConversationEventSnapshot>> {
    const initialization = await this.initialization;
    if (initialization.status === "failed") throw initialization.error;
    if (this.subscriptionState === "closed") {
      return { done: true, value: undefined };
    }
    this.throwIfAborted();

    while (this.subscriptionState === "history") {
      if (this.historyEventIndex < this.historyEvents.length) {
        this.throwIfAborted();
        const event = this.historyEvents[this.historyEventIndex] as PersistedConversationEventSnapshot;
        this.historyEventIndex += 1;
        this.resumeSequence = event.sequence;
        return { done: false, value: event };
      }
      if (this.historyEvents.length > 0 && !this.historyHasNext) {
        this.enterLivePhase();
        break;
      }

      this.throwIfAborted();
      const page = await this.pager.readNext({
        conversationId: this.conversationId,
        afterSequence: this.historyCursor,
        throughSequence: this.highWatermark,
        filter: this.options.filter,
      });
      this.throwIfAborted();
      if (this.isClosed()) {
        return { done: true, value: undefined };
      }
      this.historyPageCount += 1;
      this.historyEvents = page.events;
      this.historyEventIndex = 0;
      this.historyHasNext = page.hasNext;
      if (page.nextAfterSequence !== undefined) {
        this.historyCursor = page.nextAfterSequence;
      }
      this.logger.debug("conversation_event.catch_up.page_completed", {
        highWatermark: this.highWatermark,
        pageNumber: this.historyPageCount,
        eventCount: page.events.length,
        hasNext: page.hasNext,
      });
      if (page.events.length === 0) {
        this.enterLivePhase();
        break;
      }
    }

    return this.readLive();
  }

  private async readLive(): Promise<IteratorResult<PersistedConversationEventSnapshot>> {
    while (true) {
      this.throwIfAborted();
      const result = await this.liveSubscription.next();
      this.throwIfAborted();
      if (result.done) {
        this.subscriptionState = "closed";
        this.removeAbortListener();
        this.notifyTerminated();
        return result;
      }
      if (result.value.sequence <= this.highWatermark) {
        this.skippedLiveDuplicateCount += 1;
        this.logger.debug("conversation_event.live_duplicate_skipped", {
          eventId: result.value.id,
          eventType: result.value.eventType,
          direction: result.value.direction,
          sequence: result.value.sequence,
          highWatermark: this.highWatermark,
          skippedDuplicateCount: this.skippedLiveDuplicateCount,
        });
        continue;
      }
      this.resumeSequence = result.value.sequence;
      return result;
    }
  }

  private enterLivePhase(): void {
    if (this.subscriptionState === "closed" || this.subscriptionState === "failed") return;
    const wasHistory = this.subscriptionState === "history";
    this.subscriptionState = "live";
    this.historyEvents = [];
    this.historyEventIndex = 0;
    this.historyHasNext = false;
    if (wasHistory) {
      this.logger.info("conversation_event.catch_up.completed", {
        resumeSequence: this.resumeSequence,
        highWatermark: this.highWatermark,
        pageCount: this.historyPageCount,
      });
    }
    this.logger.info("conversation_event.follow.started", {
      resumeSequence: this.resumeSequence,
      highWatermark: this.highWatermark,
    });
  }

  private getInitialCursor(
    start: ConversationEventSubscriptionStart,
    highWatermark: number,
  ): number {
    if ("afterSequence" in start) {
      if (start.afterSequence > highWatermark) {
        throw new ConversationEventSubscriptionCursorAheadError(
          this.conversationId,
          start.afterSequence,
          highWatermark,
        );
      }
      return start.afterSequence;
    }
    return start.from === "latest" ? highWatermark : 0;
  }

  private async closeOnce(): Promise<void> {
    if (this.subscriptionState !== "failed") this.subscriptionState = "closed";
    this.removeAbortListener();
    await this.liveSubscription.close();
    const activeRead = this.activeRead;
    if (activeRead !== undefined) await activeRead.catch(() => undefined);
    await this.initialization;
    this.historyEvents = [];
    this.notifyTerminated();
  }

  private readonly handleAbort = (): void => {
    if (this.subscriptionState === "closed" || this.subscriptionState === "failed") return;
    this.terminateWithFailure(this.createAbortedError());
  };

  private terminateWithFailure(error: Error): void {
    if (this.subscriptionState === "closed" || this.subscriptionState === "failed") return;
    this.subscriptionState = "failed";
    this.failure = error;
    this.historyEvents = [];
    this.removeAbortListener();
    void this.liveSubscription.close().catch((closeError: unknown) => {
      this.logger.error("conversation_event.follow.live_close_failed", {
        errorName: closeError instanceof Error ? closeError.name : "UnknownError",
      });
    });
    const errorCode = this.getErrorCode(error);
    this.logger.error("conversation_event.follow.failed", {
      errorName: error.name,
      ...(errorCode !== undefined ? { errorCode } : {}),
      resumeSequence: this.resumeSequence,
      highWatermark: this.highWatermark,
    });
    this.notifyTerminated();
  }

  private normalizeFailure(error: unknown): Error {
    if (error instanceof ConversationEventSubscriptionOverflowError) {
      return new ConversationEventSubscriptionOverflowError(
        this.id,
        this.conversationId,
        error.capacity,
        this.resumeSequence,
      );
    }
    if (error instanceof ConversationEventSubscriptionAbortedError) {
      return this.createAbortedError(error);
    }
    return error instanceof Error ? error : new Error("Conversation Event follow failed");
  }

  private throwIfAborted(): void {
    if (this.options.signal?.aborted === true) throw this.createAbortedError();
  }

  private createAbortedError(cause?: unknown): ConversationEventSubscriptionAbortedError {
    const abortCause = cause ?? this.options.signal?.reason;
    return new ConversationEventSubscriptionAbortedError(
      this.id,
      this.conversationId,
      this.resumeSequence,
      abortCause === undefined ? undefined : { cause: abortCause },
    );
  }

  private removeAbortListener(): void {
    this.options.signal?.removeEventListener("abort", this.handleAbort);
  }

  private notifyTerminated(): void {
    if (this.terminationNotified) return;
    this.terminationNotified = true;
    try {
      this.onTerminated?.(this);
    } catch (error) {
      this.logger.error("conversation_event.follow.termination_callback_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  private isClosed(): boolean {
    return this.subscriptionState === "closed";
  }

  private getErrorCode(error: Error): string | undefined {
    return "code" in error && typeof error.code === "string" ? error.code : undefined;
  }
}
