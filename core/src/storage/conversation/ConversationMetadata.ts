export type ConversationStatus = "active" | "archived" | "disposed";

export interface ConversationMetadata {
  id: string;
  workspaceId: string;
  parentConversationId?: string;
  rootConversationId: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
  lastJournalSequence: number;
}
