/**
 * Platform-neutral contracts for the repairable per-Conversation Runtime
 * Message projection file. Node adapters may use JSONL without exposing file
 * mechanics to Conversation or Runtime layers.
 */
import type {
  MessageProjectionFileRecord,
  MessageProjectionCheckpointRecord,
  MessageProjectionHeaderRecord,
  MessageProjectionMessageRecord,
  MessageProjectionSequenceState,
} from "../protocol/index.js";
import type { MessageProjectionReplacementWriter } from "./MessageProjectionReplacementWriter.js";

export type MessageProjectionFileStatus =
  | "missing"
  | "valid"
  | "repairable_tail"
  | "corrupted";

export interface MessageProjectionFileErrorSummary {
  name: string;
  code?: string;
  message: string;
}

export interface MessageProjectionFileSnapshot {
  size: number;
  modifiedAtMs: number;
}

export interface MessageProjectionFileScan {
  conversationId: string;
  status: MessageProjectionFileStatus;
  totalByteLength: number;
  committedByteLength: number;
  trailingByteLength: number;
  completeRecordCount: number;
  committedRecordCount: number;
  trailingRecordCount: number;
  header?: MessageProjectionHeaderRecord;
  state?: MessageProjectionSequenceState;
  error?: MessageProjectionFileErrorSummary;
  fileSnapshot?: MessageProjectionFileSnapshot;
}

export interface ScanConversationMessageFileOptions {
  allowUnknownMessageTypes?: boolean;
}

export interface ConversationMessageFileQuery extends ScanConversationMessageFileOptions {
  conversationId: string;
  afterMessageIndex?: number;
  highWatermarkMessageIndex?: number;
  limit?: number;
}

export interface ConversationMessageFilePage {
  conversationId: string;
  items: readonly MessageProjectionMessageRecord[];
  highWatermarkMessageIndex: number;
  projectedThroughSequence: number;
  hasMore: boolean;
  nextAfterMessageIndex?: number;
}

export interface LockedConversationMessageFile {
  readonly conversationId: string;

  scan(options?: ScanConversationMessageFileOptions): Promise<MessageProjectionFileScan>;

  initialize(
    records: readonly [MessageProjectionHeaderRecord, MessageProjectionCheckpointRecord],
  ): Promise<MessageProjectionFileScan>;

  appendCommittedBatch(
    records: readonly MessageProjectionFileRecord[],
  ): Promise<MessageProjectionFileScan>;

  truncateToCommitted(scan: MessageProjectionFileScan): Promise<MessageProjectionFileScan>;

  replace(records: readonly MessageProjectionFileRecord[]): Promise<MessageProjectionFileScan>;

  replaceAtomically(
    initialRecords: readonly [
      MessageProjectionHeaderRecord,
      MessageProjectionCheckpointRecord,
    ],
    operation: (replacement: MessageProjectionReplacementWriter) => Promise<void>,
  ): Promise<MessageProjectionFileScan>;
}

export interface ConversationMessageFileStore {
  scan(
    conversationId: string,
    options?: ScanConversationMessageFileOptions,
  ): Promise<MessageProjectionFileScan>;

  list(query: ConversationMessageFileQuery): Promise<ConversationMessageFilePage>;

  withExclusive<T>(
    conversationId: string,
    operation: (file: LockedConversationMessageFile) => Promise<T>,
  ): Promise<T>;

  close(): Promise<void>;
}
