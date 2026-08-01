/**
 * Canonical JSONL records used by the repairable Runtime Message projection.
 * A valid empty projection contains one Header followed by Checkpoint zero.
 */
import type { EventKind } from "../../../event/index.js";
import type { RuntimeMessageSnapshot } from "../../../runtime/index.js";

export const MESSAGE_PROJECTION_FORMAT_VERSION = 1 as const;
export const MESSAGE_PROJECTION_HASH_ALGORITHM = "sha256" as const;

export interface MessageProjectionRecordIdentity {
  formatVersion: typeof MESSAGE_PROJECTION_FORMAT_VERSION;
  workspaceId: string;
  conversationId: string;
}

export interface MessageProjectionHeaderRecord extends MessageProjectionRecordIdentity {
  recordType: "header";
  projectorId: string;
  projectorVersion: string;
  hashAlgorithm: typeof MESSAGE_PROJECTION_HASH_ALGORITHM;
  createdAt: string;
  previousHash: null;
  recordHash: string;
}

export interface MessageProjectionMessageSource {
  sequence: number;
  eventId: string;
  eventType: string;
  direction: EventKind;
  ordinal: number;
}

export interface MessageProjectionMessageRecord extends MessageProjectionRecordIdentity {
  recordType: "message";
  messageIndex: number;
  source: MessageProjectionMessageSource;
  message: RuntimeMessageSnapshot;
  previousHash: string;
  recordHash: string;
}

export interface MessageProjectionCheckpointRecord extends MessageProjectionRecordIdentity {
  recordType: "checkpoint";
  projectedThroughSequence: number;
  messageCount: number;
  committedAt: string;
  previousHash: string;
  recordHash: string;
}

export type MessageProjectionFileRecord =
  | MessageProjectionHeaderRecord
  | MessageProjectionMessageRecord
  | MessageProjectionCheckpointRecord;

export type UnsignedMessageProjectionFileRecord =
  | Omit<MessageProjectionHeaderRecord, "recordHash">
  | Omit<MessageProjectionMessageRecord, "recordHash">
  | Omit<MessageProjectionCheckpointRecord, "recordHash">;

export interface CreateMessageProjectionHeaderInput {
  workspaceId: string;
  conversationId: string;
  projectorId: string;
  projectorVersion: string;
  createdAt: string;
}

export interface CreateMessageProjectionMessageInput {
  workspaceId: string;
  conversationId: string;
  messageIndex: number;
  source: MessageProjectionMessageSource;
  message: RuntimeMessageSnapshot;
  previousHash: string;
}

export interface CreateMessageProjectionCheckpointInput {
  workspaceId: string;
  conversationId: string;
  projectedThroughSequence: number;
  messageCount: number;
  committedAt: string;
  previousHash: string;
}
