export interface MessageProjectionSequenceState {
  workspaceId: string;
  conversationId: string;
  projectorId: string;
  projectorVersion: string;
  recordCount: number;
  messageCount: number;
  lastRecordHash: string;
  lastMessageIndex: number;
  lastSourceSequence?: number;
  lastSourceOrdinal?: number;
  hasCommittedCheckpoint: boolean;
  committedThroughSequence: number;
  committedMessageCount: number;
  committedRecordCount: number;
  committedRecordHash?: string;
  trailingRecordCount: number;
}
