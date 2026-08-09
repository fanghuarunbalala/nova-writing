import type { ConversationMode } from "../../runtime/compose/index.js";

export type ConversationStatus = "active" | "archived" | "disposed";

export interface ConversationMetadata {
  id: string;
  workspaceId: string;
  parentConversationId?: string;
  rootConversationId: string;
  status: ConversationStatus;
  /** 对话标题（可改名）。Conversation title (renameable). */
  title?: string;
  /** 是否置顶。Whether the conversation is pinned. */
  pinned?: boolean;
  /** 会话持久模式（review/bypass/compose），权威状态来源。Conversation mode. */
  mode?: ConversationMode;
  createdAt: string;
  updatedAt: string;
  lastJournalSequence: number;
}
