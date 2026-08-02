/** Shared headless client entrypoint used by GUI, Web, CLI, and TUI. */
import type { Conversation } from "../conversation/index.js";

export interface ConversationApi {
  open(conversationId: string): Promise<Conversation>;
}

export interface NovelApiClient {
  readonly conversations: ConversationApi;
}
