/** Persistence boundary for Conversation-to-Novel and active-Draft bindings. */
import type { ConversationNovelBinding } from "../integration/index.js";
import type { NovelDraftSessionId, NovelId } from "../identity/index.js";
import type { NovelTimestamp } from "../version/index.js";

export interface BindConversationNovelInput {
  readonly conversationId: string;
  readonly novelId: NovelId;
  readonly boundAt: NovelTimestamp;
}

export interface BindConversationActiveDraftInput extends BindConversationNovelInput {
  readonly draftSessionId: NovelDraftSessionId;
}

export interface ClearConversationActiveDraftInput {
  readonly conversationId: string;
  readonly novelId: NovelId;
  readonly expectedDraftSessionId: NovelDraftSessionId;
  readonly clearedAt: NovelTimestamp;
}

export interface ConversationNovelBindingStore {
  bind(input: BindConversationNovelInput): Promise<ConversationNovelBinding>;
  bindActiveDraft(input: BindConversationActiveDraftInput): Promise<ConversationNovelBinding>;
  clearActiveDraft(input: ClearConversationActiveDraftInput): Promise<ConversationNovelBinding>;
  getBinding(novelId: NovelId, conversationId: string): Promise<ConversationNovelBinding | undefined>;
  close(): Promise<void>;
}
