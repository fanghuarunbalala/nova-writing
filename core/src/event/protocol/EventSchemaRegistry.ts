import { Type, type TSchema } from "typebox";
import { Check, Errors } from "typebox/value";
import type { InputEventSnapshot } from "../input/InputEventSnapshot.js";
import type { OutputEventSnapshot } from "../output/OutputEventSnapshot.js";
import { isEventType, type EventKind } from "./EventType.js";
import { EventValidationError, type EventValidationIssue } from "./EventValidationError.js";
import { isJsonValue } from "./JsonValue.js";

const metadataProperties = {
  id: Type.String({ minLength: 1 }),
  conversationId: Type.String({ minLength: 1 }),
  eventType: Type.String({ minLength: 3 }),
  schemaVersion: Type.Integer({ minimum: 1 }),
  timestamp: Type.String({ minLength: 1 }),
  correlationId: Type.Optional(Type.String({ minLength: 1 })),
  causationId: Type.Optional(Type.String({ minLength: 1 })),
  runId: Type.Optional(Type.String({ minLength: 1 })),
  turnId: Type.Optional(Type.String({ minLength: 1 })),
  payload: Type.Record(Type.String(), Type.Unknown()),
};

const inputEventSnapshotSchema = Type.Object(
  {
    ...metadataProperties,
    priority: Type.Integer(),
  },
  { additionalProperties: false },
);

const outputEventSnapshotSchema = Type.Object(
  {
    ...metadataProperties,
    inputEvent: Type.Optional(
      Type.Object(
        {
          id: Type.String({ minLength: 1 }),
          eventType: Type.String({ minLength: 3 }),
          sequence: Type.Optional(Type.Integer({ minimum: 1 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export interface EventSchemaDefinition<TPayloadSchema extends TSchema = TSchema> {
  eventType: string;
  schemaVersion: number;
  kind: EventKind;
  payloadSchema: TPayloadSchema;
  priority?: number;
}

export interface ValidateEventOptions {
  allowUnknownEventType?: boolean;
}

export class EventSchemaRegistry {
  private readonly definitions = new Map<string, EventSchemaDefinition>();

  register(definition: EventSchemaDefinition): void {
    const key = this.getKey(definition.kind, definition.eventType, definition.schemaVersion);
    if (this.definitions.has(key)) {
      throw new EventValidationError(`Event schema already registered: ${key}`);
    }
    if (!isEventType(definition.eventType)) {
      throw new EventValidationError(`Invalid event type: ${definition.eventType}`);
    }
    if (definition.kind === "input" && definition.priority === undefined) {
      throw new EventValidationError(`Input event schema requires priority: ${definition.eventType}`);
    }
    this.definitions.set(key, definition);
  }

  validateInput(value: unknown, options: ValidateEventOptions = {}): InputEventSnapshot {
    this.assertSchema(inputEventSnapshotSchema, value, "Invalid input event snapshot");
    const snapshot = value as InputEventSnapshot;
    this.assertCommon(snapshot);

    const definition = this.findDefinition("input", snapshot.eventType, snapshot.schemaVersion);
    if (!definition) {
      if (!options.allowUnknownEventType) {
        throw new EventValidationError(
          `Unknown input event schema: ${snapshot.eventType}@${snapshot.schemaVersion}`,
        );
      }
      return snapshot;
    }

    if (snapshot.priority !== definition.priority) {
      throw new EventValidationError(
        `Input priority mismatch for ${snapshot.eventType}: expected ${definition.priority}, received ${snapshot.priority}`,
      );
    }

    this.assertPayload(definition, snapshot.payload);
    return snapshot;
  }

  validateOutput(value: unknown, options: ValidateEventOptions = {}): OutputEventSnapshot {
    this.assertSchema(outputEventSnapshotSchema, value, "Invalid output event snapshot");
    const snapshot = value as OutputEventSnapshot;
    this.assertCommon(snapshot);

    const definition = this.findDefinition("output", snapshot.eventType, snapshot.schemaVersion);
    if (!definition) {
      if (!options.allowUnknownEventType) {
        throw new EventValidationError(
          `Unknown output event schema: ${snapshot.eventType}@${snapshot.schemaVersion}`,
        );
      }
      return snapshot;
    }

    this.assertPayload(definition, snapshot.payload);
    return snapshot;
  }

  private assertCommon(snapshot: InputEventSnapshot | OutputEventSnapshot): void {
    if (!isEventType(snapshot.eventType)) {
      throw new EventValidationError(`Invalid event type: ${snapshot.eventType}`);
    }
    if (Number.isNaN(Date.parse(snapshot.timestamp))) {
      throw new EventValidationError(`Invalid event timestamp: ${snapshot.timestamp}`);
    }
    if (!isJsonValue(snapshot.payload)) {
      throw new EventValidationError(`Event payload must be JSON-safe: ${snapshot.eventType}`);
    }
  }

  private assertPayload(definition: EventSchemaDefinition, payload: unknown): void {
    this.assertSchema(
      definition.payloadSchema,
      payload,
      `Invalid payload for ${definition.eventType}@${definition.schemaVersion}`,
    );
  }

  private assertSchema(schema: TSchema, value: unknown, message: string): void {
    if (Check(schema, value)) return;
    const issues: EventValidationIssue[] = [...Errors(schema, value)].map((error) => ({
      path: error.instancePath,
      message: error.message,
    }));
    throw new EventValidationError(message, issues);
  }

  private findDefinition(
    kind: EventKind,
    eventType: string,
    schemaVersion: number,
  ): EventSchemaDefinition | undefined {
    return this.definitions.get(this.getKey(kind, eventType, schemaVersion));
  }

  private getKey(kind: EventKind, eventType: string, schemaVersion: number): string {
    return `${kind}:${eventType}@${schemaVersion}`;
  }
}
