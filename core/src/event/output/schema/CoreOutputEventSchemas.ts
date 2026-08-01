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

const DurableInputEventReferenceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    eventType: Type.String({ minLength: 3 }),
    sequence: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const HostInputRoutedSnapshotSchema = Type.Object(
  {
    inputEvent: DurableInputEventReferenceSchema,
  },
  { additionalProperties: true },
);

const RunStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("waiting_interaction"),
  Type.Literal("stopping"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

const TurnStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("waiting_tool"),
  Type.Literal("waiting_interaction"),
  Type.Literal("stopping"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

export const AgentRunStateChangedPayloadSchema = Type.Object(
  {
    inputEvent: DurableInputEventReferenceSchema,
    previous: Type.Union([Type.Null(), RunStatusSchema]),
    current: RunStatusSchema,
    reason: Type.Union([
      Type.Literal("input_queued"),
      Type.Literal("execution_started"),
      Type.Literal("interaction_requested"),
      Type.Literal("interaction_resolved"),
      Type.Literal("stop_requested"),
      Type.Literal("interrupt_requested"),
      Type.Literal("execution_completed"),
      Type.Literal("execution_failed"),
      Type.Literal("cancellation_completed"),
      Type.Literal("recovery_restored"),
    ]),
  },
  { additionalProperties: false },
);

export const AgentTurnStateChangedPayloadSchema = Type.Object(
  {
    previous: Type.Union([Type.Null(), TurnStatusSchema]),
    current: TurnStatusSchema,
    reason: Type.Union([
      Type.Literal("provider_started"),
      Type.Literal("tool_execution_started"),
      Type.Literal("tool_execution_completed"),
      Type.Literal("interaction_requested"),
      Type.Literal("interaction_resolved"),
      Type.Literal("stop_requested"),
      Type.Literal("interrupt_requested"),
      Type.Literal("turn_completed"),
      Type.Literal("turn_failed"),
      Type.Literal("cancellation_completed"),
      Type.Literal("recovery_restored"),
    ]),
  },
  { additionalProperties: false },
);

const AgentRunStateChangedSnapshotSchema = Type.Object(
  {
    runId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: true },
);

const AgentTurnStateChangedSnapshotSchema = Type.Object(
  {
    runId: Type.String({ minLength: 1 }),
    turnId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: true },
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
    snapshotSchema: HostInputRoutedSnapshotSchema,
  });

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.agentRunStateChanged,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: AgentRunStateChangedPayloadSchema,
    snapshotSchema: AgentRunStateChangedSnapshotSchema,
  });

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.agentTurnStateChanged,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: AgentTurnStateChangedPayloadSchema,
    snapshotSchema: AgentTurnStateChangedSnapshotSchema,
  });
}
