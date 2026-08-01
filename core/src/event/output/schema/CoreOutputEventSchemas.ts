/** Registers Core-owned Runtime lifecycle and Host routing OutputEvent schemas. */
import { Type } from "typebox";
import { EVENT_SCHEMA_VERSION } from "../../protocol/EventMetadata.js";
import type { EventSchemaRegistry } from "../../protocol/EventSchemaRegistry.js";
import { OUTPUT_EVENT_TYPE } from "../OutputEventType.js";

const RuntimePresenceStateSchema = Type.Union([
  Type.Literal("offline"),
  Type.Literal("starting"),
  Type.Literal("online"),
  Type.Literal("stopping"),
  Type.Literal("crashed"),
]);

const RuntimePresenceSchema = Type.Object(
  {
    state: RuntimePresenceStateSchema,
    observedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const RuntimePresenceChangedPayloadSchema = Type.Object(
  {
    previous: RuntimePresenceSchema,
    current: RuntimePresenceSchema,
    reason: Type.Union([
      Type.Literal("accepted_input"),
      Type.Literal("explicit_restore"),
      Type.Literal("crash_recovery"),
      Type.Literal("activation_succeeded"),
      Type.Literal("activation_failed"),
      Type.Literal("explicit_shutdown"),
      Type.Literal("host_close"),
      Type.Literal("idle_eviction"),
      Type.Literal("replacement"),
      Type.Literal("runtime_stopped"),
      Type.Literal("runtime_crashed"),
      Type.Literal("exit_observer_failed"),
      Type.Literal("shutdown_failed"),
    ]),
  },
  { additionalProperties: false },
);

export const HostInputRoutedPayloadSchema = Type.Object(
  {
    handler: Type.Union([Type.Literal("stop"), Type.Literal("reload_config")]),
    outcome: Type.Union([
      Type.Literal("runtime_notified"),
      Type.Literal("no_runtime"),
      Type.Literal("deferred"),
    ]),
  },
  { additionalProperties: false },
);

export function registerCoreOutputEventSchemas(registry: EventSchemaRegistry): void {
  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.runtimePresenceChanged,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: RuntimePresenceChangedPayloadSchema,
  });

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.hostInputRouted,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: HostInputRoutedPayloadSchema,
  });
}
