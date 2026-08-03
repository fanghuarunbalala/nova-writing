/** Shared headless client entrypoint used by GUI, Web, CLI, and TUI. */
import type {
  Conversation,
  ConversationCatalogResult,
  CreateConversationOptions,
  ListConversationsOptions,
} from "../conversation/index.js";

export interface ConversationApi {
  create(options: CreateConversationOptions): Promise<Conversation>;

  list(options?: ListConversationsOptions): Promise<ConversationCatalogResult>;

  open(conversationId: string): Promise<Conversation>;
}

export interface NovelApiClient {
  readonly conversations: ConversationApi;
}
