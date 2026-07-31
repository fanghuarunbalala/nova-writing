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
}
