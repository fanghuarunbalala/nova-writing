/**
 * Read-only Conversation query service backed by durable Catalog and Journal
 * ports plus the Journal catch-up subscription service.
 */
import { noopLogger, type Logger } from "../../observability/index.js";
import { OUTPUT_EVENT_TYPE } from "../../event/index.js";
import type { JsonValue } from "../../event/protocol/index.js";
import {
  JournalConversationNotFoundError,
  type ConversationCatalogStore,
  type ConversationEventPage,
  type ConversationEventSubscription,
  type ConversationEventSubscriptionService,
  type ConversationJournalReader,
  type PersistedConversationEventSnapshot,
} from "../../storage/index.js";
import { ConversationNotFoundError } from "../ConversationErrors.js";
import type {
  GlobalApprovalOperation,
  GlobalApprovalProjection,
} from "../ConversationApprovalProjection.js";
import type {
  BoundConversationEventSubscriptionOptions,
  ConversationEventListOptions,
} from "../ConversationEvents.js";
import type { ConversationQueryService } from "../ConversationQueryService.js";
import type { ConversationSnapshot } from "../ConversationSnapshot.js";

export interface StorageConversationQueryServiceOptions {
  workspaceId: string;
  catalog: ConversationCatalogStore;
  journal: ConversationJournalReader;
  subscriptions: ConversationEventSubscriptionService;
  logger?: Logger;
}

export class StorageConversationQueryService implements ConversationQueryService {
  private readonly workspaceId: string;
  private readonly catalog: ConversationCatalogStore;
  private readonly journal: ConversationJournalReader;
  private readonly subscriptions: ConversationEventSubscriptionService;
  private readonly logger: Logger;

  constructor(options: StorageConversationQueryServiceOptions) {
    this.workspaceId = options.workspaceId;
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

  async listApprovals(): Promise<readonly GlobalApprovalProjection[]> {
    const conversations = await this.catalog.listConversationMetadata({
      workspaceId: this.workspaceId,
      status: "active",
    });
    const approvals: GlobalApprovalProjection[] = [];
    for (const conversation of conversations) {
      const conversationId = conversation.id;
      const byId = new Map<string, GlobalApprovalProjection>();
      let afterSequence: number | undefined;
      while (true) {
        const page = await this.journal.list({
          conversationId,
          anchor:
            afterSequence === undefined
              ? { from: "start" }
              : { afterSequence },
          eventTypes: APPROVAL_EVENT_TYPES,
          limit: APPROVAL_PAGE_LIMIT,
        });
        for (const event of page.events) {
          applyApprovalEvent(byId, conversationId, event);
        }
        if (!page.hasNext || page.events.length === 0) break;
        afterSequence = page.events[page.events.length - 1].sequence;
      }
      approvals.push(...byId.values());
    }
    return Object.freeze(approvals.map((approval) => Object.freeze(approval)));
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

const APPROVAL_EVENT_TYPES: string[] = [
  OUTPUT_EVENT_TYPE.toolApprovalRequested,
  OUTPUT_EVENT_TYPE.toolApprovalResolved,
];

const APPROVAL_PAGE_LIMIT = 500;

function applyApprovalEvent(
  byId: Map<string, GlobalApprovalProjection>,
  conversationId: string,
  event: PersistedConversationEventSnapshot,
): void {
  const payload = isRecord(event.payload) ? event.payload : {};
  const approvalRequestId = asString(payload.approvalRequestId);
  if (approvalRequestId === undefined) return;

  if (event.eventType === OUTPUT_EVENT_TYPE.toolApprovalRequested) {
    const summary = isRecord(payload.summary) ? payload.summary : undefined;
    const title =
      asString(summary?.title) ?? asString(payload.toolName) ?? "工具审批";
    const description = asString(summary?.description);
    const operations = captureGlobalOperations(summary?.operations);
    byId.set(
      approvalRequestId,
      Object.freeze({
        conversationId,
        approvalRequestId,
        toolCallId: asString(payload.toolCallId) ?? "",
        toolName: asString(payload.toolName) ?? "?",
        toolVersion: asString(payload.toolVersion) ?? "",
        argumentDigest: asString(payload.argumentDigest) as `sha256:${string}`,
        runId: event.runId ?? "",
        ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
        title,
        ...(description === undefined ? {} : { description }),
        ...(operations === undefined ? {} : { operations }),
        ...(summary?.arguments === undefined
          ? {}
          : { arguments: summary.arguments as JsonValue }),
        status: "pending",
        requestedAt: asString(payload.requestedAt) ?? event.timestamp,
        expiresAt: asString(payload.expiresAt) ?? event.timestamp,
      }) as GlobalApprovalProjection,
    );
    return;
  }

  const existing = byId.get(approvalRequestId);
  if (existing === undefined) return;
  const decision = asString(payload.decision);
  if (
    decision !== "approved" &&
    decision !== "rejected" &&
    decision !== "cancelled" &&
    decision !== "expired"
  ) {
    return;
  }
  const actorId = asString(payload.actorId);
  byId.set(
    approvalRequestId,
    Object.freeze({
      ...existing,
      status: decision,
      ...(actorId === undefined ? {} : { actorId }),
      resolvedAt: asString(payload.resolvedAt) ?? event.timestamp,
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function captureGlobalOperations(
  value: unknown,
): readonly GlobalApprovalOperation[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const operations = value
    .map((item): GlobalApprovalOperation | undefined => {
      if (!isRecord(item)) return undefined;
      const op = item.op;
      if (op !== "add" && op !== "edit" && op !== "delete") return undefined;
      const kind = asString(item.kind);
      if (kind === undefined) return undefined;
      const id = asString(item.id);
      const title = asString(item.title);
      return Object.freeze({
        op,
        kind,
        ...(id === undefined ? {} : { id }),
        ...(title === undefined ? {} : { title }),
      });
    })
    .filter((item): item is GlobalApprovalOperation => item !== undefined);
  return operations.length > 0 ? Object.freeze(operations) : undefined;
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
