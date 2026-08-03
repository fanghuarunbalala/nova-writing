/** Public Conversation catalog commands and queries used before opening a handle. */
import type {
  AgentBindingIdentity,
  ConversationStatus,
} from "../../storage/index.js";
import type { ConversationSnapshot } from "../ConversationSnapshot.js";

export interface CreateConversationOptions {
  readonly conversationId?: string;
  readonly parentConversationId?: string;
  readonly agent: AgentBindingIdentity;
}

export interface ListConversationsOptions {
  readonly rootConversationId?: string;
  readonly parentConversationId?: string;
  readonly status?: ConversationStatus;
  readonly limit?: number;
}

export interface ConversationCatalogResult {
  readonly conversations: readonly ConversationSnapshot[];
}

export interface ConversationCatalogService {
  create(options: CreateConversationOptions): Promise<ConversationSnapshot>;

  list(options?: ListConversationsOptions): Promise<ConversationCatalogResult>;
}

export interface ConversationIdGenerator {
  generate(): string;
}

export class RandomConversationIdGenerator implements ConversationIdGenerator {
  generate(): string {
    return `conversation_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
  }
}
