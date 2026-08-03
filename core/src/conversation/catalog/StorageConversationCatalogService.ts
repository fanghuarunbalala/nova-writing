/** Binds public Conversation catalog operations to one Workspace catalog store. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  ConversationAgentBindingMissingError,
  type ConversationCatalogStore,
  type ConversationListQuery,
} from "../../storage/index.js";
import type { ConversationSnapshot } from "../ConversationSnapshot.js";
import {
  RandomConversationIdGenerator,
  type ConversationCatalogResult,
  type ConversationCatalogService,
  type ConversationIdGenerator,
  type CreateConversationOptions,
  type ListConversationsOptions,
} from "./ConversationCatalogService.js";

export interface StorageConversationCatalogServiceOptions {
  readonly catalog: ConversationCatalogStore;
  readonly workspaceId: string;
  readonly conversationIdGenerator?: ConversationIdGenerator;
  readonly logger?: Logger;
}

export class StorageConversationCatalogService
  implements ConversationCatalogService
{
  private readonly catalog: ConversationCatalogStore;
  private readonly workspaceId: string;
  private readonly conversationIdGenerator: ConversationIdGenerator;
  private readonly logger: Logger;

  constructor(options: StorageConversationCatalogServiceOptions) {
    this.catalog = options.catalog;
    this.workspaceId = captureNonEmptyString(options.workspaceId, "Workspace id");
    this.conversationIdGenerator =
      options.conversationIdGenerator ?? new RandomConversationIdGenerator();
    this.logger = (options.logger ?? noopLogger).child({
      component: "storage_conversation_catalog_service",
      workspaceId: this.workspaceId,
    });
  }

  async create(options: CreateConversationOptions): Promise<ConversationSnapshot> {
    const conversationId = captureNonEmptyString(
      options.conversationId ?? this.conversationIdGenerator.generate(),
      "Conversation id",
    );
    const parentConversationId = captureOptionalNonEmptyString(
      options.parentConversationId,
      "Parent Conversation id",
    );
    const agent = Object.freeze({
      agentType: captureNonEmptyString(options.agent.agentType, "Agent type"),
      definitionVersion: captureNonEmptyString(
        options.agent.definitionVersion,
        "Agent definition version",
      ),
      ...(options.agent.manifestId !== undefined
        ? {
            manifestId: captureNonEmptyString(
              options.agent.manifestId,
              "Agent manifest ID",
            ),
          }
        : {}),
      ...(options.agent.manifestDigest !== undefined
        ? {
            manifestDigest: captureNonEmptyString(
              options.agent.manifestDigest,
              "Agent manifest digest",
            ),
          }
        : {}),
    });
    this.logger.info("conversation_catalog.create_started", {
      conversationId,
      hasParent: parentConversationId !== undefined,
    });
    const stored = await this.catalog.createConversation({
      id: conversationId,
      workspaceId: this.workspaceId,
      ...(parentConversationId !== undefined ? { parentConversationId } : {}),
      agent,
    });
    this.logger.info("conversation_catalog.create_completed", {
      conversationId,
      hasParent: parentConversationId !== undefined,
    });
    return freezeSnapshot(stored);
  }

  async list(
    options: ListConversationsOptions = {},
  ): Promise<ConversationCatalogResult> {
    const query: ConversationListQuery = {
      workspaceId: this.workspaceId,
      ...(options.rootConversationId !== undefined
        ? {
            rootConversationId: captureNonEmptyString(
              options.rootConversationId,
              "Root Conversation id",
            ),
          }
        : {}),
      ...(options.parentConversationId !== undefined
        ? {
            parentConversationId: captureNonEmptyString(
              options.parentConversationId,
              "Parent Conversation id",
            ),
          }
        : {}),
      ...(options.status !== undefined
        ? { status: captureStatus(options.status) }
        : {}),
      ...(options.limit !== undefined
        ? { limit: captureLimit(options.limit) }
        : {}),
    };
    this.logger.debug("conversation_catalog.list_started", {
      hasRootFilter: query.rootConversationId !== undefined,
      hasParentFilter: query.parentConversationId !== undefined,
      hasStatusFilter: query.status !== undefined,
      hasLimit: query.limit !== undefined,
    });
    const metadata = await this.catalog.listConversationMetadata(query);
    const conversations = await Promise.all(
      metadata.map(async (item): Promise<ConversationSnapshot> => {
        const activeAgentBinding = await this.catalog.getActiveAgentBinding(item.id);
        if (activeAgentBinding === undefined) {
          throw new ConversationAgentBindingMissingError(item.id);
        }
        return freezeSnapshot({ metadata: item, activeAgentBinding });
      }),
    );
    this.logger.debug("conversation_catalog.list_completed", {
      conversationCount: conversations.length,
    });
    return Object.freeze({ conversations: Object.freeze(conversations) });
  }
}

function freezeSnapshot(snapshot: ConversationSnapshot): ConversationSnapshot {
  return Object.freeze({
    metadata: Object.freeze({ ...snapshot.metadata }),
    activeAgentBinding: Object.freeze({ ...snapshot.activeAgentBinding }),
  });
}

function captureNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function captureOptionalNonEmptyString(
  value: unknown,
  label: string,
): string | undefined {
  return value === undefined ? undefined : captureNonEmptyString(value, label);
}

function captureLimit(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 1_000
  ) {
    throw new TypeError("Conversation list limit must be an integer from 1 through 1000");
  }
  return value as number;
}

function captureStatus(
  value: unknown,
): "active" | "archived" | "disposed" {
  if (value !== "active" && value !== "archived" && value !== "disposed") {
    throw new TypeError("Conversation status is invalid");
  }
  return value;
}
