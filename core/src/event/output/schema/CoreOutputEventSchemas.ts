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

const DurableInputResponseSnapshotSchema = Type.Object(
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

const NonCancelledRunStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("waiting_interaction"),
  Type.Literal("stopping"),
  Type.Literal("completed"),
  Type.Literal("failed"),
]);

const NonCancelledTurnStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("waiting_tool"),
  Type.Literal("waiting_interaction"),
  Type.Literal("stopping"),
  Type.Literal("completed"),
  Type.Literal("failed"),
]);

const ExecutionCancellationReasonSchema = Type.Union([
  Type.Literal("stop"),
  Type.Literal("interrupt"),
  Type.Literal("parent_stop"),
  Type.Literal("runtime_shutdown"),
  Type.Literal("runtime_replaced"),
]);

const RunStateChangeReasonSchema = Type.Union([
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
]);

const TurnStateChangeReasonSchema = Type.Union([
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
]);

export const AgentRunStateChangedPayloadSchema = Type.Union([
  Type.Object(
    {
      inputEvent: DurableInputEventReferenceSchema,
      previous: Type.Union([Type.Null(), RunStatusSchema]),
      current: NonCancelledRunStatusSchema,
      reason: RunStateChangeReasonSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      inputEvent: DurableInputEventReferenceSchema,
      previous: Type.Union([Type.Null(), RunStatusSchema]),
      current: Type.Literal("cancelled"),
      reason: RunStateChangeReasonSchema,
      cancellationReason: ExecutionCancellationReasonSchema,
    },
    { additionalProperties: false },
  ),
]);

export const AgentTurnStateChangedPayloadSchema = Type.Union([
  Type.Object(
    {
      previous: Type.Union([Type.Null(), TurnStatusSchema]),
      current: NonCancelledTurnStatusSchema,
      reason: TurnStateChangeReasonSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      previous: Type.Union([Type.Null(), TurnStatusSchema]),
      current: Type.Literal("cancelled"),
      reason: TurnStateChangeReasonSchema,
      cancellationReason: ExecutionCancellationReasonSchema,
    },
    { additionalProperties: false },
  ),
]);

export const RuntimeInputProcessedPayloadSchema = Type.Union([
  Type.Object(
    {
      outcome: Type.Literal("consumed"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      outcome: Type.Literal("cancelled_before_run"),
      cancellationReason: ExecutionCancellationReasonSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      outcome: Type.Literal("failed"),
      failureCode: Type.Union([
        Type.Literal("unsupported_input"),
        Type.Literal("invalid_runtime_state"),
        Type.Literal("processing_failed"),
      ]),
    },
    { additionalProperties: false },
  ),
]);

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

const AssistantMessageIdentityPayloadSchema = Type.Object(
  {
    assistantMessageId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const AgentAssistantMessageDeltaPayloadSchema = Type.Object(
  {
    assistantMessageId: Type.String({ minLength: 1 }),
    deltaOrdinal: Type.Integer({ minimum: 0 }),
    contentIndex: Type.Integer({ minimum: 0 }),
    channel: Type.Union([Type.Literal("text"), Type.Literal("thinking")]),
    delta: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const AssistantMessageContentSchema = Type.Union([
  Type.Object(
    { type: Type.Literal("text"), text: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("thinking"),
      thinking: Type.String(),
      redacted: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
]);

export const AgentAssistantMessageCompletedPayloadSchema = Type.Object(
  {
    assistantMessageId: Type.String({ minLength: 1 }),
    content: Type.Array(AssistantMessageContentSchema),
    completionReason: Type.Union([
      Type.Literal("stop"),
      Type.Literal("length"),
      Type.Literal("tool_use"),
    ]),
    hasToolCalls: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AgentAssistantMessageFailedPayloadSchema = Type.Object(
  {
    assistantMessageId: Type.String({ minLength: 1 }),
    failureCode: Type.Union([
      Type.Literal("provider_error"),
      Type.Literal("provider_aborted"),
    ]),
  },
  { additionalProperties: false },
);

const NudgePublicIdentityProperties = {
  nudgeId: Type.String({ minLength: 1 }),
  policyId: Type.String({ minLength: 1 }),
  templateId: Type.String({ minLength: 1 }),
  templateVersion: Type.String({ minLength: 1 }),
  targetTurnNumber: Type.Optional(Type.Integer({ minimum: 1 })),
};

export const NudgeScheduledPayloadSchema = Type.Object(
  {
    ...NudgePublicIdentityProperties,
    state: Type.Literal("scheduled"),
  },
  { additionalProperties: false },
);

export const SystemReminderInjectedPayloadSchema = Type.Object(
  {
    ...NudgePublicIdentityProperties,
    leaseId: Type.String({ minLength: 1 }),
    providerCallId: Type.String({ minLength: 1 }),
    state: Type.Literal("consumed"),
  },
  { additionalProperties: false },
);

export const NudgeExpiredPayloadSchema = Type.Object(
  {
    ...NudgePublicIdentityProperties,
    state: Type.Literal("expired"),
  },
  { additionalProperties: false },
);

const ContextLifecycleSnapshotSchema = Type.Object({ runId: Type.String({ minLength: 1 }) }, { additionalProperties: true });
export const ContextCompactionStartedPayloadSchema = Type.Object({ providerCallId: Type.String({ minLength: 1 }), trigger: Type.Union([Type.Literal("automatic"), Type.Literal("hard_admission_risk"), Type.Literal("explicit")]), tokenEstimateBefore: Type.Integer({ minimum: 0 }), targetTokens: Type.Integer({ minimum: 0 }), hardAdmissionTokens: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
export const ContextCompactionCompletedPayloadSchema = Type.Object({ providerCallId: Type.String({ minLength: 1 }), checkpointId: Type.String({ minLength: 1 }), outcome: Type.Union([Type.Literal("target_met"), Type.Literal("reduced"), Type.Literal("degraded")]), sourceStartSequence: Type.Integer({ minimum: 0 }), sourceEndSequence: Type.Integer({ minimum: 0 }), tokenEstimateBefore: Type.Integer({ minimum: 0 }), tokenEstimateAfter: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
export const ContextCompactionFailedPayloadSchema = Type.Object({ providerCallId: Type.String({ minLength: 1 }), failure: Type.String({ minLength: 1 }), tokenEstimateBefore: Type.Optional(Type.Integer({ minimum: 0 })), tokenEstimateAfter: Type.Optional(Type.Integer({ minimum: 0 })), sourceStartSequence: Type.Optional(Type.Integer({ minimum: 0 })), sourceEndSequence: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false });
export const ContextCheckpointAppliedPayloadSchema = Type.Object({ providerCallId: Type.String({ minLength: 1 }), checkpointId: Type.String({ minLength: 1 }) }, { additionalProperties: false });

const ToolApprovalIdentityProperties = {
  approvalRequestId: Type.String({ minLength: 1, maxLength: 256 }),
  toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
  toolName: Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" }),
  toolVersion: Type.String({ pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$" }),
  argumentDigest: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" }),
};
export const ToolApprovalRequestedPayloadSchema = Type.Object({
  ...ToolApprovalIdentityProperties,
  summary: Type.Object({
    title: Type.String({ minLength: 1, maxLength: 256 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  }, { additionalProperties: false }),
  requestedAt: Type.String({ minLength: 1 }),
  expiresAt: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const ToolApprovalResolvedPayloadSchema = Type.Object({
  ...ToolApprovalIdentityProperties,
  decision: Type.Union([
    Type.Literal("approved"), Type.Literal("rejected"),
    Type.Literal("cancelled"), Type.Literal("expired"),
  ]),
  actorId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  resolvedAt: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

const NudgeLifecycleSnapshotSchema = Type.Object(
  {
    runId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: true },
);

const AgentAssistantMessageSnapshotSchema = Type.Object(
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
    snapshotSchema: DurableInputResponseSnapshotSchema,
  });

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.runtimeInputProcessed,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: RuntimeInputProcessedPayloadSchema,
    snapshotSchema: DurableInputResponseSnapshotSchema,
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

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.agentAssistantMessageStarted,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: AssistantMessageIdentityPayloadSchema,
    snapshotSchema: AgentAssistantMessageSnapshotSchema,
  });

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.agentAssistantMessageDelta,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: AgentAssistantMessageDeltaPayloadSchema,
    snapshotSchema: AgentAssistantMessageSnapshotSchema,
  });

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.agentAssistantMessageCompleted,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: AgentAssistantMessageCompletedPayloadSchema,
    snapshotSchema: AgentAssistantMessageSnapshotSchema,
  });

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.agentAssistantMessageFailed,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: AgentAssistantMessageFailedPayloadSchema,
    snapshotSchema: AgentAssistantMessageSnapshotSchema,
  });

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.agentAssistantMessageCancelled,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: AssistantMessageIdentityPayloadSchema,
    snapshotSchema: AgentAssistantMessageSnapshotSchema,
  });

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.nudgeScheduled,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: NudgeScheduledPayloadSchema,
    snapshotSchema: NudgeLifecycleSnapshotSchema,
  });
  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.toolApprovalRequested,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: ToolApprovalRequestedPayloadSchema,
    snapshotSchema: NudgeLifecycleSnapshotSchema,
  });
  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.toolApprovalResolved,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: ToolApprovalResolvedPayloadSchema,
    snapshotSchema: NudgeLifecycleSnapshotSchema,
  });

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.systemReminderInjected,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: SystemReminderInjectedPayloadSchema,
    snapshotSchema: NudgeLifecycleSnapshotSchema,
  });

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.nudgeExpired,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: NudgeExpiredPayloadSchema,
    snapshotSchema: NudgeLifecycleSnapshotSchema,
  });
  for (const [eventType, payloadSchema] of [
    [OUTPUT_EVENT_TYPE.contextCompactionStarted, ContextCompactionStartedPayloadSchema],
    [OUTPUT_EVENT_TYPE.contextCompactionCompleted, ContextCompactionCompletedPayloadSchema],
    [OUTPUT_EVENT_TYPE.contextCompactionFailed, ContextCompactionFailedPayloadSchema],
    [OUTPUT_EVENT_TYPE.contextCheckpointApplied, ContextCheckpointAppliedPayloadSchema],
  ] as const) registry.register({ kind: "output", eventType, schemaVersion: EVENT_SCHEMA_VERSION, payloadSchema, snapshotSchema: ContextLifecycleSnapshotSchema });
}
