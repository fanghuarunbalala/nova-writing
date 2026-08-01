/**
 * Validates already-decoded records as one ordered Message projection stream.
 * It tracks the latest committed Checkpoint separately from valid trailing
 * records so a future file adapter can truncate an interrupted append safely.
 */
import type {
  MessageProjectionCheckpointRecord,
  MessageProjectionFileRecord,
  MessageProjectionHeaderRecord,
  MessageProjectionMessageRecord,
} from "./MessageProjectionFileRecord.js";
import {
  MessageProjectionChainMismatchError,
  MessageProjectionCheckpointError,
  MessageProjectionFormatError,
  MessageProjectionIdentityMismatchError,
  MessageProjectionSequenceError,
  type MessageProjectionErrorContext,
} from "./MessageProjectionProtocolErrors.js";
import type { MessageProjectionSequenceState } from "./MessageProjectionSequenceState.js";

export interface MessageProjectionRecordSequenceValidatorOptions {
  expectedWorkspaceId?: string;
  expectedConversationId?: string;
  expectedProjectorId?: string;
  expectedProjectorVersion?: string;
}

export class MessageProjectionRecordSequenceValidator {
  private readonly options: MessageProjectionRecordSequenceValidatorOptions;
  private header: MessageProjectionHeaderRecord | undefined;
  private recordCount = 0;
  private messageCount = 0;
  private lastMessageIndex = 0;
  private lastRecordHash: string | undefined;
  private lastSourceSequence: number | undefined;
  private lastSourceOrdinal: number | undefined;
  private batchLastSourceSequence: number | undefined;
  private batchLastSourceOrdinal: number | undefined;
  private batchLastSourceEventId: string | undefined;
  private batchLastSourceEventType: string | undefined;
  private batchLastSourceDirection: "input" | "output" | undefined;
  private readonly messageIds = new Set<string>();
  private hasCommittedCheckpoint = false;
  private committedThroughSequence = 0;
  private committedMessageCount = 0;
  private committedRecordCount = 0;
  private committedRecordHash: string | undefined;

  constructor(options: MessageProjectionRecordSequenceValidatorOptions = {}) {
    this.options = options;
  }

  accept(record: MessageProjectionFileRecord): void {
    if (this.recordCount === 0) {
      this.acceptHeader(record);
      return;
    }
    if (record.recordType === "header") {
      throw new MessageProjectionSequenceError(
        "Message projection Header may only appear as the first record",
        this.context(record),
      );
    }

    const header = this.requireHeader();
    this.assertRecordIdentity(record, header);
    if (record.previousHash !== this.lastRecordHash) {
      throw new MessageProjectionChainMismatchError(this.context(record));
    }

    if (record.recordType === "message") {
      this.acceptMessage(record);
    } else {
      this.acceptCheckpoint(record);
    }
  }

  acceptAll(records: readonly MessageProjectionFileRecord[]): MessageProjectionSequenceState {
    for (const record of records) this.accept(record);
    return this.getState();
  }

  getState(): MessageProjectionSequenceState {
    const header = this.requireHeader();
    const lastRecordHash = this.lastRecordHash;
    if (lastRecordHash === undefined) {
      throw new MessageProjectionFormatError("Message projection has no accepted records");
    }

    return {
      workspaceId: header.workspaceId,
      conversationId: header.conversationId,
      projectorId: header.projectorId,
      projectorVersion: header.projectorVersion,
      recordCount: this.recordCount,
      messageCount: this.messageCount,
      lastRecordHash,
      lastMessageIndex: this.lastMessageIndex,
      ...(this.lastSourceSequence !== undefined
        ? { lastSourceSequence: this.lastSourceSequence }
        : {}),
      ...(this.lastSourceOrdinal !== undefined ? { lastSourceOrdinal: this.lastSourceOrdinal } : {}),
      hasCommittedCheckpoint: this.hasCommittedCheckpoint,
      committedThroughSequence: this.committedThroughSequence,
      committedMessageCount: this.committedMessageCount,
      committedRecordCount: this.committedRecordCount,
      ...(this.committedRecordHash !== undefined
        ? { committedRecordHash: this.committedRecordHash }
        : {}),
      trailingRecordCount: this.recordCount - this.committedRecordCount,
    };
  }

  private acceptHeader(record: MessageProjectionFileRecord): void {
    if (record.recordType !== "header") {
      throw new MessageProjectionSequenceError(
        "Message projection must begin with a Header record",
        this.context(record),
      );
    }

    this.assertExpectedIdentity(record);
    this.header = record;
    this.recordCount = 1;
    this.lastRecordHash = record.recordHash;
  }

  private acceptMessage(record: MessageProjectionMessageRecord): void {
    if (!this.hasCommittedCheckpoint) {
      throw new MessageProjectionCheckpointError(
        "Message records require an initial Checkpoint zero",
        this.context(record),
      );
    }
    if (record.message.conversationId !== record.conversationId) {
      throw new MessageProjectionIdentityMismatchError(
        "Runtime Message conversation does not match its projection record",
        this.context(record),
      );
    }
    if (this.messageIds.has(record.message.id)) {
      throw new MessageProjectionSequenceError(
        `Runtime Message ID is duplicated: ${record.message.id}`,
        this.context(record),
      );
    }

    const expectedMessageIndex = this.messageCount + 1;
    if (record.messageIndex !== expectedMessageIndex) {
      throw new MessageProjectionSequenceError(
        `Message index must be ${expectedMessageIndex}, received ${record.messageIndex}`,
        this.context(record),
      );
    }
    if (record.source.sequence <= this.committedThroughSequence) {
      throw new MessageProjectionSequenceError(
        `Message source sequence must be greater than committed sequence ${this.committedThroughSequence}`,
        this.context(record),
      );
    }

    if (this.batchLastSourceSequence === undefined) {
      if (record.source.ordinal !== 0) {
        throw new MessageProjectionSequenceError(
          "The first Message for a projection batch must use source ordinal zero",
          this.context(record),
        );
      }
    } else if (record.source.sequence === this.batchLastSourceSequence) {
      if (
        record.source.eventId !== this.batchLastSourceEventId ||
        record.source.eventType !== this.batchLastSourceEventType ||
        record.source.direction !== this.batchLastSourceDirection
      ) {
        throw new MessageProjectionSequenceError(
          "Messages sharing one source sequence must reference the same Event",
          this.context(record),
        );
      }
      const expectedOrdinal = (this.batchLastSourceOrdinal ?? -1) + 1;
      if (record.source.ordinal !== expectedOrdinal) {
        throw new MessageProjectionSequenceError(
          `Source ordinal must be ${expectedOrdinal}, received ${record.source.ordinal}`,
          this.context(record),
        );
      }
    } else {
      if (record.source.sequence < this.batchLastSourceSequence) {
        throw new MessageProjectionSequenceError(
          "Message source sequence must not move backwards within a projection batch",
          this.context(record),
        );
      }
      if (record.source.ordinal !== 0) {
        throw new MessageProjectionSequenceError(
          "The first Message for a new source Event must use ordinal zero",
          this.context(record),
        );
      }
    }

    this.recordCount += 1;
    this.messageCount += 1;
    this.messageIds.add(record.message.id);
    this.lastMessageIndex = record.messageIndex;
    this.lastRecordHash = record.recordHash;
    this.lastSourceSequence = record.source.sequence;
    this.lastSourceOrdinal = record.source.ordinal;
    this.batchLastSourceSequence = record.source.sequence;
    this.batchLastSourceOrdinal = record.source.ordinal;
    this.batchLastSourceEventId = record.source.eventId;
    this.batchLastSourceEventType = record.source.eventType;
    this.batchLastSourceDirection = record.source.direction;
  }

  private acceptCheckpoint(record: MessageProjectionCheckpointRecord): void {
    if (!this.hasCommittedCheckpoint) {
      if (record.projectedThroughSequence !== 0 || record.messageCount !== 0) {
        throw new MessageProjectionCheckpointError(
          "The initial Checkpoint must commit sequence zero with zero Messages",
          this.context(record),
        );
      }
    } else {
      if (record.projectedThroughSequence <= this.committedThroughSequence) {
        throw new MessageProjectionCheckpointError(
          `Checkpoint sequence must be greater than ${this.committedThroughSequence}`,
          this.context(record),
        );
      }
      if (
        this.batchLastSourceSequence !== undefined &&
        record.projectedThroughSequence < this.batchLastSourceSequence
      ) {
        throw new MessageProjectionCheckpointError(
          "Checkpoint sequence cannot precede a Message source sequence in the current batch",
          this.context(record),
        );
      }
      if (record.messageCount !== this.messageCount) {
        throw new MessageProjectionCheckpointError(
          `Checkpoint message count must be ${this.messageCount}, received ${record.messageCount}`,
          this.context(record),
        );
      }
    }

    this.recordCount += 1;
    this.lastRecordHash = record.recordHash;
    this.hasCommittedCheckpoint = true;
    this.committedThroughSequence = record.projectedThroughSequence;
    this.committedMessageCount = record.messageCount;
    this.committedRecordCount = this.recordCount;
    this.committedRecordHash = record.recordHash;
    this.batchLastSourceSequence = undefined;
    this.batchLastSourceOrdinal = undefined;
    this.batchLastSourceEventId = undefined;
    this.batchLastSourceEventType = undefined;
    this.batchLastSourceDirection = undefined;
  }

  private assertRecordIdentity(
    record: Exclude<MessageProjectionFileRecord, MessageProjectionHeaderRecord>,
    header: MessageProjectionHeaderRecord,
  ): void {
    if (record.workspaceId !== header.workspaceId) {
      throw new MessageProjectionIdentityMismatchError(
        `Projection workspace ${record.workspaceId} does not match Header workspace ${header.workspaceId}`,
        this.context(record),
      );
    }
    if (record.conversationId !== header.conversationId) {
      throw new MessageProjectionIdentityMismatchError(
        `Projection Conversation ${record.conversationId} does not match Header Conversation ${header.conversationId}`,
        this.context(record),
      );
    }
  }

  private assertExpectedIdentity(header: MessageProjectionHeaderRecord): void {
    const expectations: Array<[string, string | undefined, string]> = [
      ["workspace", this.options.expectedWorkspaceId, header.workspaceId],
      ["Conversation", this.options.expectedConversationId, header.conversationId],
      ["projector", this.options.expectedProjectorId, header.projectorId],
      ["projector version", this.options.expectedProjectorVersion, header.projectorVersion],
    ];
    for (const [label, expected, actual] of expectations) {
      if (expected !== undefined && expected !== actual) {
        throw new MessageProjectionIdentityMismatchError(
          `Message projection ${label} ${actual} does not match expected ${expected}`,
          this.context(header),
        );
      }
    }
  }

  private requireHeader(): MessageProjectionHeaderRecord {
    if (this.header === undefined) {
      throw new MessageProjectionFormatError("Message projection Header has not been accepted");
    }
    return this.header;
  }

  private context(record: MessageProjectionFileRecord): MessageProjectionErrorContext {
    return {
      recordType: record.recordType,
      recordIndex: this.recordCount + 1,
      conversationId: record.conversationId,
      ...(record.recordType === "message"
        ? {
            messageIndex: record.messageIndex,
            sourceSequence: record.source.sequence,
          }
        : {}),
    };
  }
}
