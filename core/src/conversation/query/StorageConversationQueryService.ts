/**
 * Read-only Conversation query service backed by durable Catalog and Journal
 * ports plus the Journal catch-up subscription service.
 */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  JournalConversationNotFoundError,
  type ConversationCatalogStore,
  type ConversationEventPage,
  type ConversationEventSubscription,
  type ConversationEventSubscriptionService,
  type ConversationJournalReader,
} from "../../storage/index.js";
import { ConversationNotFoundError } from "../ConversationErrors.js";
import type {
  BoundConversationEventSubscriptionOptions,
  ConversationEventListOptions,
} from "../ConversationEvents.js";
import type { ConversationQueryService } from "../ConversationQueryService.js";
import type { ConversationSnapshot } from "../ConversationSnapshot.js";

export interface StorageConversationQueryServiceOptions {
  catalog: ConversationCatalogStore;
  journal: ConversationJournalReader;
  subscriptions: ConversationEventSubscriptionService;
  logger?: Logger;
}

export class StorageConversationQueryService implements ConversationQueryService {
  private readonly catalog: ConversationCatalogStore;
  private readonly journal: ConversationJournalReader;
  private readonly subscriptions: ConversationEventSubscriptionService;
  private readonly logger: Logger;

  constructor(options: StorageConversationQueryServiceOptions) {
    this.catalog = options.catalog;
    this.journal = options.journal;
    this.subscriptions = options.subscriptions;
    this.logger = (options.logger ?? noopLogger).child({
      component: "storage_conversation_query_service",
    });
  }

  async getSnapshot(conversationId: string): Promise<ConversationSnapshot> {
    const stored = await this.catalog.getConversation(conversationId);
    if (stored === undefined) {
      this.logger.debug("conversation.query.not_found", { conversationId });
      throw new ConversationNotFoundError(conversationId);
    }

    const snapshot = freezeConversationSnapshot(stored);
    this.logger.debug("conversation.query.snapshot_completed", {
      conversationId,
      status: snapshot.metadata.status,
      lastJournalSequence: snapshot.metadata.lastJournalSequence,
      agentType: snapshot.activeAgentBinding.agentType,
      definitionVersion: snapshot.activeAgentBinding.definitionVersion,
    });
    return snapshot;
  }

  async listEvents(
    conversationId: string,
    options: ConversationEventListOptions,
  ): Promise<ConversationEventPage> {
    try {
      const page = await this.journal.list(createBoundListQuery(conversationId, options));
      this.logger.debug("conversation.query.events_list_completed", {
        conversationId,
        eventCount: page.events.length,
        highWatermark: page.highWatermark,
        hasPrevious: page.hasPrevious,
        hasNext: page.hasNext,
      });
      return page;
    } catch (error) {
      if (error instanceof JournalConversationNotFoundError) {
        throw new ConversationNotFoundError(conversationId);
      }
      throw error;
    }
  }

  subscribeEvents(
    conversationId: string,
    options: BoundConversationEventSubscriptionOptions,
  ): ConversationEventSubscription {
    const subscription = this.subscriptions.subscribe(
      createBoundSubscriptionOptions(conversationId, options),
    );
    this.logger.debug("conversation.query.events_subscription_created", {
      conversationId,
      subscriptionId: subscription.id,
    });
    return subscription;
  }
}

function freezeConversationSnapshot(stored: {
  metadata: ConversationSnapshot["metadata"];
  activeAgentBinding: ConversationSnapshot["activeAgentBinding"];
}): ConversationSnapshot {
  return Object.freeze({
    metadata: Object.freeze({ ...stored.metadata }),
    activeAgentBinding: Object.freeze({ ...stored.activeAgentBinding }),
  });
}

function createBoundListQuery(
  conversationId: string,
  options: ConversationEventListOptions,
) {
  return {
    ...options,
    anchor: { ...options.anchor },
    ...(options.eventTypes !== undefined
      ? { eventTypes: [...options.eventTypes] }
      : {}),
    conversationId,
  };
}

function createBoundSubscriptionOptions(
  conversationId: string,
  options: BoundConversationEventSubscriptionOptions,
) {
  return {
    ...options,
    start: { ...options.start },
    ...(options.filter !== undefined
      ? {
          filter: {
            ...options.filter,
            ...(options.filter.eventTypes !== undefined
              ? { eventTypes: [...options.filter.eventTypes] }
              : {}),
          },
        }
      : {}),
    conversationId,
  };
}
