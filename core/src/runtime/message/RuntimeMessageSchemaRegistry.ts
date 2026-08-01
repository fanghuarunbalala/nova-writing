/**
 * Validates Core-owned Runtime Messages without importing an Agent provider's
 * message types. Registered schemas stay strict while historical readers may
 * opt into unknown message types for forward-compatible replay.
 */
import { Type, type TSchema } from "typebox";
import { Check, Errors } from "typebox/value";
import { isJsonValue } from "../../event/index.js";
import { isRuntimeMessageRole, type RuntimeMessageRole } from "./RuntimeMessageRole.js";
import type { RuntimeMessageDraft, RuntimeMessageSnapshot } from "./RuntimeMessageSnapshot.js";
import { isRuntimeMessageType } from "./RuntimeMessageType.js";
import {
  RuntimeMessageValidationError,
  type RuntimeMessageValidationIssue,
} from "./RuntimeMessageValidationError.js";

const draftProperties = {
  role: Type.Union([
    Type.Literal("user"),
    Type.Literal("assistant"),
    Type.Literal("tool"),
    Type.Literal("system"),
    Type.Literal("custom"),
  ]),
  messageType: Type.String({ minLength: 3 }),
  schemaVersion: Type.Integer({ minimum: 1 }),
  timestamp: Type.String({ minLength: 1 }),
  runId: Type.Optional(Type.String({ minLength: 1 })),
  turnId: Type.Optional(Type.String({ minLength: 1 })),
  payload: Type.Record(Type.String(), Type.Unknown()),
};

const runtimeMessageDraftSchema = Type.Object(draftProperties, { additionalProperties: false });
const runtimeMessageSnapshotSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    conversationId: Type.String({ minLength: 1 }),
    ...draftProperties,
  },
  { additionalProperties: false },
);

export interface RuntimeMessageSchemaDefinition<TPayloadSchema extends TSchema = TSchema> {
  messageType: string;
  schemaVersion: number;
  role: RuntimeMessageRole;
  payloadSchema: TPayloadSchema;
}

export interface ValidateRuntimeMessageOptions {
  allowUnknownMessageType?: boolean;
}

export class RuntimeMessageSchemaRegistry {
  private readonly definitions = new Map<string, RuntimeMessageSchemaDefinition>();

  register(definition: RuntimeMessageSchemaDefinition): void {
    if (!isRuntimeMessageType(definition.messageType)) {
      throw new RuntimeMessageValidationError(
        `Invalid runtime message type: ${definition.messageType}`,
      );
    }
    if (!Number.isSafeInteger(definition.schemaVersion) || definition.schemaVersion < 1) {
      throw new RuntimeMessageValidationError(
        `Invalid runtime message schema version: ${definition.schemaVersion}`,
      );
    }
    if (!isRuntimeMessageRole(definition.role)) {
      throw new RuntimeMessageValidationError(`Invalid runtime message role: ${definition.role}`);
    }

    const key = this.getKey(definition.messageType, definition.schemaVersion);
    if (this.definitions.has(key)) {
      throw new RuntimeMessageValidationError(`Runtime message schema already registered: ${key}`);
    }
    this.definitions.set(key, definition);
  }

  validateDraft(
    value: unknown,
    options: ValidateRuntimeMessageOptions = {},
  ): RuntimeMessageDraft {
    this.assertSchema(runtimeMessageDraftSchema, value, "Invalid runtime message draft");
    const draft = value as RuntimeMessageDraft;
    this.assertCommon(draft);
    this.assertRegisteredPayload(draft, options);
    return draft;
  }

  validateSnapshot(
    value: unknown,
    options: ValidateRuntimeMessageOptions = {},
  ): RuntimeMessageSnapshot {
    this.assertSchema(runtimeMessageSnapshotSchema, value, "Invalid runtime message snapshot");
    const snapshot = value as RuntimeMessageSnapshot;
    this.assertNonBlank("runtime message id", snapshot.id);
    this.assertNonBlank("conversation id", snapshot.conversationId);
    this.assertCommon(snapshot);
    this.assertRegisteredPayload(snapshot, options);
    return snapshot;
  }

  private assertCommon(message: RuntimeMessageDraft): void {
    if (!isRuntimeMessageRole(message.role)) {
      throw new RuntimeMessageValidationError(`Invalid runtime message role: ${message.role}`);
    }
    if (!isRuntimeMessageType(message.messageType)) {
      throw new RuntimeMessageValidationError(
        `Invalid runtime message type: ${message.messageType}`,
      );
    }
    if (Number.isNaN(Date.parse(message.timestamp))) {
      throw new RuntimeMessageValidationError(
        `Invalid runtime message timestamp: ${message.timestamp}`,
      );
    }
    if (!isJsonValue(message.payload)) {
      throw new RuntimeMessageValidationError(
        `Runtime message payload must be JSON-safe: ${message.messageType}`,
      );
    }
  }

  private assertRegisteredPayload(
    message: RuntimeMessageDraft,
    options: ValidateRuntimeMessageOptions,
  ): void {
    const definition = this.definitions.get(
      this.getKey(message.messageType, message.schemaVersion),
    );
    if (!definition) {
      if (options.allowUnknownMessageType) return;
      throw new RuntimeMessageValidationError(
        `Unknown runtime message schema: ${message.messageType}@${message.schemaVersion}`,
      );
    }
    if (message.role !== definition.role) {
      throw new RuntimeMessageValidationError(
        `Runtime message role mismatch for ${message.messageType}: expected ${definition.role}, received ${message.role}`,
      );
    }
    this.assertSchema(
      definition.payloadSchema,
      message.payload,
      `Invalid payload for ${message.messageType}@${message.schemaVersion}`,
    );
  }

  private assertSchema(schema: TSchema, value: unknown, message: string): void {
    if (Check(schema, value)) return;
    const issues: RuntimeMessageValidationIssue[] = [...Errors(schema, value)].map((error) => ({
      path: error.instancePath,
      message: error.message,
    }));
    throw new RuntimeMessageValidationError(message, issues);
  }

  private assertNonBlank(label: string, value: string): void {
    if (value.trim().length === 0) {
      throw new RuntimeMessageValidationError(`${label} must not be blank`);
    }
  }

  private getKey(messageType: string, schemaVersion: number): string {
    return `${messageType}@${schemaVersion}`;
  }
}
