/**
 * Creates, encodes, decodes, and verifies canonical Message projection records.
 * File I/O and newline handling remain responsibilities of the Node adapter.
 */
import { Type, type TSchema } from "typebox";
import { Check, Errors } from "typebox/value";
import {
  canonicalStringifyJson,
  isEventType,
  isJsonValue,
  type JsonValue,
} from "../../../event/index.js";
import type { RuntimeMessageSchemaRegistry } from "../../../runtime/index.js";
import {
  MESSAGE_PROJECTION_FORMAT_VERSION,
  MESSAGE_PROJECTION_HASH_ALGORITHM,
  type CreateMessageProjectionCheckpointInput,
  type CreateMessageProjectionHeaderInput,
  type CreateMessageProjectionMessageInput,
  type MessageProjectionCheckpointRecord,
  type MessageProjectionFileRecord,
  type MessageProjectionHeaderRecord,
  type MessageProjectionMessageRecord,
  type UnsignedMessageProjectionFileRecord,
} from "./MessageProjectionFileRecord.js";
import type { MessageProjectionHasher } from "./MessageProjectionHasher.js";
import {
  MessageProjectionFormatError,
  MessageProjectionHashMismatchError,
  MessageProjectionMessageInvalidError,
  type MessageProjectionErrorContext,
} from "./MessageProjectionProtocolErrors.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const identityProperties = {
  formatVersion: Type.Literal(MESSAGE_PROJECTION_FORMAT_VERSION),
  workspaceId: Type.String({ minLength: 1 }),
  conversationId: Type.String({ minLength: 1 }),
};

const hashSchema = Type.String({ pattern: "^[a-f0-9]{64}$" });

const headerRecordSchema = Type.Object(
  {
    recordType: Type.Literal("header"),
    ...identityProperties,
    projectorId: Type.String({ minLength: 1 }),
    projectorVersion: Type.String({ minLength: 1 }),
    hashAlgorithm: Type.Literal(MESSAGE_PROJECTION_HASH_ALGORITHM),
    createdAt: Type.String({ minLength: 1 }),
    previousHash: Type.Null(),
    recordHash: hashSchema,
  },
  { additionalProperties: false },
);

const messageSourceSchema = Type.Object(
  {
    sequence: Type.Integer({ minimum: 1 }),
    eventId: Type.String({ minLength: 1 }),
    eventType: Type.String({ minLength: 3 }),
    direction: Type.Union([Type.Literal("input"), Type.Literal("output")]),
    ordinal: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const messageRecordSchema = Type.Object(
  {
    recordType: Type.Literal("message"),
    ...identityProperties,
    messageIndex: Type.Integer({ minimum: 1 }),
    source: messageSourceSchema,
    message: Type.Record(Type.String(), Type.Unknown()),
    previousHash: hashSchema,
    recordHash: hashSchema,
  },
  { additionalProperties: false },
);

const checkpointRecordSchema = Type.Object(
  {
    recordType: Type.Literal("checkpoint"),
    ...identityProperties,
    projectedThroughSequence: Type.Integer({ minimum: 0 }),
    messageCount: Type.Integer({ minimum: 0 }),
    committedAt: Type.String({ minLength: 1 }),
    previousHash: hashSchema,
    recordHash: hashSchema,
  },
  { additionalProperties: false },
);

const fileRecordSchema = Type.Union([
  headerRecordSchema,
  messageRecordSchema,
  checkpointRecordSchema,
]);

export interface DecodeMessageProjectionRecordOptions {
  allowUnknownMessageTypes?: boolean;
}

export interface MessageProjectionRecordCodecOptions {
  hasher: MessageProjectionHasher;
  messageSchemaRegistry: RuntimeMessageSchemaRegistry;
}

export class MessageProjectionRecordCodec {
  private readonly hasher: MessageProjectionHasher;
  private readonly messageSchemaRegistry: RuntimeMessageSchemaRegistry;

  constructor(options: MessageProjectionRecordCodecOptions) {
    if (options.hasher.algorithm !== MESSAGE_PROJECTION_HASH_ALGORITHM) {
      throw new MessageProjectionFormatError(
        `Unsupported Message projection hash algorithm: ${options.hasher.algorithm}`,
      );
    }
    this.hasher = options.hasher;
    this.messageSchemaRegistry = options.messageSchemaRegistry;
    this.assertHash("Message projection hasher digest", this.hasher.digest(""));
  }

  createHeader(input: CreateMessageProjectionHeaderInput): MessageProjectionHeaderRecord {
    const unsigned: Omit<MessageProjectionHeaderRecord, "recordHash"> = {
      recordType: "header",
      formatVersion: MESSAGE_PROJECTION_FORMAT_VERSION,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      projectorId: input.projectorId,
      projectorVersion: input.projectorVersion,
      hashAlgorithm: MESSAGE_PROJECTION_HASH_ALGORITHM,
      createdAt: input.createdAt,
      previousHash: null,
    };
    const record = this.signRecord(unsigned) as MessageProjectionHeaderRecord;
    this.validateRecord(record);
    return record;
  }

  createMessage(input: CreateMessageProjectionMessageInput): MessageProjectionMessageRecord {
    try {
      this.messageSchemaRegistry.validateSnapshot(input.message);
    } catch (error) {
      throw new MessageProjectionMessageInvalidError(
        {
          recordType: "message",
          messageIndex: input.messageIndex,
          sourceSequence: input.source.sequence,
          conversationId: input.conversationId,
        },
        { cause: error },
      );
    }

    const unsigned: Omit<MessageProjectionMessageRecord, "recordHash"> = {
      recordType: "message",
      formatVersion: MESSAGE_PROJECTION_FORMAT_VERSION,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      messageIndex: input.messageIndex,
      source: input.source,
      message: input.message,
      previousHash: input.previousHash,
    };
    const record = this.signRecord(unsigned) as MessageProjectionMessageRecord;
    this.validateRecord(record);
    return record;
  }

  createCheckpoint(
    input: CreateMessageProjectionCheckpointInput,
  ): MessageProjectionCheckpointRecord {
    const unsigned: Omit<MessageProjectionCheckpointRecord, "recordHash"> = {
      recordType: "checkpoint",
      formatVersion: MESSAGE_PROJECTION_FORMAT_VERSION,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      projectedThroughSequence: input.projectedThroughSequence,
      messageCount: input.messageCount,
      committedAt: input.committedAt,
      previousHash: input.previousHash,
    };
    const record = this.signRecord(unsigned) as MessageProjectionCheckpointRecord;
    this.validateRecord(record);
    return record;
  }

  encode(record: MessageProjectionFileRecord): string {
    this.validateRecord(record);
    this.verifyHash(record);
    return canonicalStringifyJson(record as unknown as JsonValue);
  }

  decode(
    line: string,
    options: DecodeMessageProjectionRecordOptions = {},
  ): MessageProjectionFileRecord {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new MessageProjectionFormatError("Message projection line is not valid JSON", {}, {
        cause: error,
      });
    }
    if (!isJsonValue(value)) {
      throw new MessageProjectionFormatError("Message projection line is not JSON-safe");
    }
    if (canonicalStringifyJson(value) !== line) {
      throw new MessageProjectionFormatError("Message projection line is not canonical JSON");
    }

    this.assertSchema(fileRecordSchema, value, "Invalid Message projection record");
    const record = value as unknown as MessageProjectionFileRecord;
    this.validateRecord(record, options);
    this.verifyHash(record);
    return record;
  }

  verifyHash(record: MessageProjectionFileRecord): void {
    const expected = this.digestUnsignedRecord(this.toUnsignedRecord(record));
    if (record.recordHash !== expected) {
      throw new MessageProjectionHashMismatchError(this.toContext(record));
    }
  }

  private validateRecord(
    record: MessageProjectionFileRecord,
    options: DecodeMessageProjectionRecordOptions = {},
  ): void {
    this.assertSchema(fileRecordSchema, record, "Invalid Message projection record");
    this.assertNonBlank("workspace id", record.workspaceId, this.toContext(record));
    this.assertNonBlank("conversation id", record.conversationId, this.toContext(record));
    this.assertHash("record hash", record.recordHash, this.toContext(record));

    if (record.recordType === "header") {
      this.assertNonBlank("projector id", record.projectorId, this.toContext(record));
      this.assertNonBlank("projector version", record.projectorVersion, this.toContext(record));
      this.assertTimestamp("createdAt", record.createdAt, this.toContext(record));
      return;
    }

    this.assertHash("previous hash", record.previousHash, this.toContext(record));
    if (record.recordType === "checkpoint") {
      this.assertSafeInteger(
        "projectedThroughSequence",
        record.projectedThroughSequence,
        0,
        this.toContext(record),
      );
      this.assertSafeInteger("messageCount", record.messageCount, 0, this.toContext(record));
      this.assertTimestamp("committedAt", record.committedAt, this.toContext(record));
      return;
    }

    this.assertSafeInteger("messageIndex", record.messageIndex, 1, this.toContext(record));
    this.assertSafeInteger("source sequence", record.source.sequence, 1, this.toContext(record));
    this.assertSafeInteger("source ordinal", record.source.ordinal, 0, this.toContext(record));
    this.assertNonBlank("source event id", record.source.eventId, this.toContext(record));
    if (!isEventType(record.source.eventType)) {
      throw new MessageProjectionFormatError(
        `Invalid source event type: ${record.source.eventType}`,
        this.toContext(record),
      );
    }
    try {
      this.messageSchemaRegistry.validateSnapshot(record.message, {
        allowUnknownMessageType: options.allowUnknownMessageTypes,
      });
    } catch (error) {
      throw new MessageProjectionMessageInvalidError(this.toContext(record), { cause: error });
    }
  }

  private signRecord(
    record: UnsignedMessageProjectionFileRecord,
  ): MessageProjectionFileRecord {
    return {
      ...record,
      recordHash: this.digestUnsignedRecord(record),
    } as MessageProjectionFileRecord;
  }

  private digestUnsignedRecord(record: UnsignedMessageProjectionFileRecord): string {
    const canonical = canonicalStringifyJson(record as unknown as JsonValue);
    const digest = this.hasher.digest(canonical);
    this.assertHash("Message projection record digest", digest);
    return digest;
  }

  private toUnsignedRecord(
    record: MessageProjectionFileRecord,
  ): UnsignedMessageProjectionFileRecord {
    const { recordHash: _recordHash, ...unsigned } = record;
    return unsigned as UnsignedMessageProjectionFileRecord;
  }

  private assertSchema(schema: TSchema, value: unknown, message: string): void {
    if (Check(schema, value)) return;
    const details = [...Errors(schema, value)]
      .map((error) => `${error.instancePath || "/"}: ${error.message}`)
      .join("; ");
    throw new MessageProjectionFormatError(details.length > 0 ? `${message}: ${details}` : message);
  }

  private assertNonBlank(
    label: string,
    value: string,
    context: MessageProjectionErrorContext = {},
  ): void {
    if (value.trim().length === 0) {
      throw new MessageProjectionFormatError(`${label} must not be blank`, context);
    }
  }

  private assertTimestamp(
    label: string,
    value: string,
    context: MessageProjectionErrorContext,
  ): void {
    if (Number.isNaN(Date.parse(value))) {
      throw new MessageProjectionFormatError(`${label} must be a valid timestamp`, context);
    }
  }

  private assertSafeInteger(
    label: string,
    value: number,
    minimum: number,
    context: MessageProjectionErrorContext,
  ): void {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new MessageProjectionFormatError(
        `${label} must be a safe integer greater than or equal to ${minimum}`,
        context,
      );
    }
  }

  private assertHash(
    label: string,
    value: string,
    context: MessageProjectionErrorContext = {},
  ): void {
    if (!SHA256_PATTERN.test(value)) {
      throw new MessageProjectionFormatError(`${label} must be a lowercase SHA-256 digest`, context);
    }
  }

  private toContext(record: MessageProjectionFileRecord): MessageProjectionErrorContext {
    return {
      recordType: record.recordType,
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
