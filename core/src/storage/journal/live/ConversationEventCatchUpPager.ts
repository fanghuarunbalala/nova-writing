/** Strict bounded Journal pagination for catch-up before live Event delivery. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { ConversationJournalReader } from "../ConversationJournalStore.js";
import type { PersistedConversationEventSnapshot } from "../PersistedConversationEventSnapshot.js";
import {
  ConversationEventFilterMatcher,
  type NormalizedConversationEventFilter,
} from "./ConversationEventFilter.js";
import {
  ConversationEventSubscriptionJournalPageError,
  ConversationEventSubscriptionJournalWatermarkError,
} from "./ConversationEventLiveErrors.js";

export const DEFAULT_CONVERSATION_EVENT_CATCH_UP_PAGE_SIZE = 200;
export const MAX_CONVERSATION_EVENT_CATCH_UP_PAGE_SIZE = 1_000;

export interface ConversationEventCatchUpPagerOptions {
  journal: ConversationJournalReader;
  logger?: Logger;
  pageSize?: number;
}

export interface ReadConversationEventCatchUpPageInput {
  conversationId: string;
  afterSequence: number;
  throughSequence: number;
  filter: NormalizedConversationEventFilter;
}

export interface ConversationEventCatchUpPage {
  events: readonly PersistedConversationEventSnapshot[];
  highWatermark: number;
  hasNext: boolean;
  nextAfterSequence?: number;
}

export class ConversationEventCatchUpPager {
  readonly pageSize: number;

  private readonly journal: ConversationJournalReader;
  private readonly logger: Logger;

  constructor(options: ConversationEventCatchUpPagerOptions) {
    this.journal = options.journal;
    this.pageSize = this.validatePageSize(
      options.pageSize ?? DEFAULT_CONVERSATION_EVENT_CATCH_UP_PAGE_SIZE,
    );
    this.logger = (options.logger ?? noopLogger).child({
      component: "conversation_event_catch_up_pager",
      pageSize: this.pageSize,
    });
  }

  async readNext(
    input: ReadConversationEventCatchUpPageInput,
  ): Promise<ConversationEventCatchUpPage> {
    const page = await this.journal.list({
      conversationId: input.conversationId,
      anchor: { afterSequence: input.afterSequence },
      throughSequence: input.throughSequence,
      ...(input.filter.direction !== undefined
        ? { direction: input.filter.direction }
        : {}),
      ...(input.filter.eventTypes !== undefined
        ? { eventTypes: [...input.filter.eventTypes] }
        : {}),
      ...(input.filter.runId !== undefined ? { runId: input.filter.runId } : {}),
      ...(input.filter.turnId !== undefined ? { turnId: input.filter.turnId } : {}),
      limit: this.pageSize,
    });
    if (page.highWatermark !== input.throughSequence) {
      throw new ConversationEventSubscriptionJournalWatermarkError(
        input.conversationId,
        input.throughSequence,
        page.highWatermark,
      );
    }
    if (!Array.isArray(page.events) || page.events.length > this.pageSize) {
      throw this.invalidPage(input.conversationId, "Journal page size is invalid");
    }
    if (typeof page.hasNext !== "boolean") {
      throw this.invalidPage(input.conversationId, "Journal page hasNext is invalid");
    }
    if (page.hasNext && page.events.length === 0) {
      throw this.invalidPage(
        input.conversationId,
        "Journal page cannot be empty when hasNext is true",
      );
    }

    const matcher = new ConversationEventFilterMatcher(input.filter);
    let previousSequence = input.afterSequence;
    for (const event of page.events) {
      if (event.conversationId !== input.conversationId) {
        throw this.invalidPage(
          input.conversationId,
          "Journal page contains an Event from another Conversation",
        );
      }
      if (!Number.isSafeInteger(event.sequence) || event.sequence <= previousSequence) {
        throw this.invalidPage(
          input.conversationId,
          "Journal page Event Sequences must be strictly increasing",
        );
      }
      if (event.sequence > input.throughSequence) {
        throw this.invalidPage(
          input.conversationId,
          "Journal page contains an Event beyond the fixed High Watermark",
        );
      }
      if (!matcher.matches(event)) {
        throw this.invalidPage(
          input.conversationId,
          "Journal page contains an Event that does not match the subscription filter",
        );
      }
      previousSequence = event.sequence;
    }

    const nextAfterSequence = page.events.at(-1)?.sequence;
    this.logger.debug("conversation_event.catch_up.page_read", {
      conversationId: input.conversationId,
      afterSequence: input.afterSequence,
      throughSequence: input.throughSequence,
      eventCount: page.events.length,
      hasNext: page.hasNext,
    });
    return {
      events: Object.freeze([...page.events]),
      highWatermark: page.highWatermark,
      hasNext: page.hasNext,
      ...(nextAfterSequence !== undefined ? { nextAfterSequence } : {}),
    };
  }

  private validatePageSize(value: number): number {
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > MAX_CONVERSATION_EVENT_CATCH_UP_PAGE_SIZE
    ) {
      throw new TypeError(
        `Conversation Event catch-up pageSize must be an integer between 1 and ${MAX_CONVERSATION_EVENT_CATCH_UP_PAGE_SIZE}`,
      );
    }
    return value;
  }

  private invalidPage(
    conversationId: string,
    message: string,
  ): ConversationEventSubscriptionJournalPageError {
    return new ConversationEventSubscriptionJournalPageError(
      conversationId,
      message,
    );
  }
}
