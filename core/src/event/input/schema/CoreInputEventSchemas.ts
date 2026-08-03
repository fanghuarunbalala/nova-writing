import { Type } from "typebox";
import { EVENT_SCHEMA_VERSION } from "../../protocol/EventMetadata.js";
import type { EventSchemaRegistry } from "../../protocol/EventSchemaRegistry.js";
import { INPUT_EVENT_TYPE } from "../InputEventType.js";
import { INPUT_PRIORITY } from "../InputPriority.js";

export const EmptyInputPayloadSchema = Type.Object({}, { additionalProperties: false });

export const UserMessagePayloadSchema = Type.Object(
  {
    text: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const TaskAssignedArtifactReferenceSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    artifactId: Type.String({ minLength: 1, maxLength: 256 }),
    conversationId: Type.String({ minLength: 1, maxLength: 256 }),
    contentType: Type.String({ minLength: 1 }),
    byteLength: Type.Integer({ minimum: 0 }),
    tokenEstimate: Type.Optional(Type.Integer({ minimum: 0 })),
    digest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
    filename: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  },
  { additionalProperties: false },
);

export const TaskAssignedPayloadSchema = Type.Object(
  {
    taskId: Type.String({ minLength: 1, maxLength: 256 }),
    requesterConversationId: Type.String({ minLength: 1, maxLength: 256 }),
    prompt: Type.String({ minLength: 1, maxLength: 16 * 1024 }),
    artifactReferences: Type.Array(TaskAssignedArtifactReferenceSchema, {
      maxItems: 8,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export const ReloadConfigPayloadSchema = Type.Object(
  {
    config: Type.Object(
      {
        runtime: Type.Literal("agent"),
        locale: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const ApprovalDecisionPayloadSchema = Type.Object(
  {
    approvalRequestId: Type.String({ minLength: 1, maxLength: 256 }),
    decision: Type.Union([
      Type.Literal("approved"),
      Type.Literal("rejected"),
    ]),
    argumentDigest: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);

export function registerCoreInputEventSchemas(registry: EventSchemaRegistry): void {
  registry.register({
    kind: "input",
    eventType: INPUT_EVENT_TYPE.userMessage,
    schemaVersion: EVENT_SCHEMA_VERSION,
    priority: INPUT_PRIORITY.user,
    payloadSchema: UserMessagePayloadSchema,
  });

  registry.register({
    kind: "input",
    eventType: INPUT_EVENT_TYPE.taskAssigned,
    schemaVersion: EVENT_SCHEMA_VERSION,
    priority: INPUT_PRIORITY.system,
    payloadSchema: TaskAssignedPayloadSchema,
  });

  registry.register({
    kind: "input",
    eventType: INPUT_EVENT_TYPE.systemStop,
    schemaVersion: EVENT_SCHEMA_VERSION,
    priority: INPUT_PRIORITY.system,
    payloadSchema: EmptyInputPayloadSchema,
  });

  registry.register({
    kind: "input",
    eventType: INPUT_EVENT_TYPE.reloadConfig,
    schemaVersion: EVENT_SCHEMA_VERSION,
    priority: INPUT_PRIORITY.command,
    payloadSchema: ReloadConfigPayloadSchema,
  });

  registry.register({
    kind: "input",
    eventType: INPUT_EVENT_TYPE.clearContext,
    schemaVersion: EVENT_SCHEMA_VERSION,
    priority: INPUT_PRIORITY.context,
    payloadSchema: EmptyInputPayloadSchema,
  });

  registry.register({
    kind: "input",
    eventType: INPUT_EVENT_TYPE.compactContext,
    schemaVersion: EVENT_SCHEMA_VERSION,
    priority: INPUT_PRIORITY.context,
    payloadSchema: EmptyInputPayloadSchema,
  });

  registry.register({
    kind: "input",
    eventType: INPUT_EVENT_TYPE.approvalDecision,
    schemaVersion: EVENT_SCHEMA_VERSION,
    priority: INPUT_PRIORITY.command,
    payloadSchema: ApprovalDecisionPayloadSchema,
  });
}
