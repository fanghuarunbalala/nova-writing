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
  readonly title?: string;
  readonly pinned?: boolean;
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

  /** 重命名对话。Renames a conversation. */
  rename(conversationId: string, title: string): Promise<ConversationSnapshot>;

  /** 置顶/取消置顶。Pins or unpins a conversation. */
  pin(conversationId: string, pinned: boolean): Promise<ConversationSnapshot>;

  /** 删除对话（软删除）。Deletes a conversation (soft). */
  delete(conversationId: string): Promise<void>;
}

export interface ConversationIdGenerator {
  generate(): string;
}

export class RandomConversationIdGenerator implements ConversationIdGenerator {
  generate(): string {
    return `conversation_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
  }
}
