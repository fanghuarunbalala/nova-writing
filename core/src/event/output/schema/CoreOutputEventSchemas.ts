/** Registers Core-owned Runtime lifecycle and Host routing OutputEvent schemas. */
import { Type } from "typebox";
import { EVENT_SCHEMA_VERSION } from "../../protocol/EventMetadata.js";
import type { EventSchemaRegistry } from "../../protocol/EventSchemaRegistry.js";
import { OUTPUT_EVENT_TYPE } from "../OutputEventType.js";
import { REMINDER_KIND } from "../payload/SystemReminderAttachedPayload.js";
import { registerNovelLifecycleOutputEventSchemas } from "./NovelLifecycleOutputEventSchemas.js";
import { registerNovelComposeOutputEventSchemas } from "./NovelComposeOutputEventSchemas.js";
import { registerNovelModeOutputEventSchemas } from "./NovelModeOutputEventSchemas.js";

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
    failureDetail: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
  },
  { additionalProperties: false },
);

const TodoItemSchema = Type.Object(
  {
    content: Type.String({ minLength: 1, maxLength: 2_000 }),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("in_progress"),
      Type.Literal("completed"),
    ]),
    activeForm: Type.String({ minLength: 1, maxLength: 2_000 }),
  },
  { additionalProperties: false },
);

export const AgentTodoUpdatedPayloadSchema = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    revision: Type.Integer({ minimum: 1 }),
    todos: Type.Array(TodoItemSchema, { maxItems: 32 }),
    updatedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const AgentTodoUpdatedSnapshotSchema = Type.Object(
  {
    runId: Type.String({ minLength: 1 }),
    turnId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: true },
);

const WorkItemItemSchema = Type.Object(
  {
    id: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }),
    subject: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.String({ minLength: 0, maxLength: 4_000 }),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("in_progress"),
      Type.Literal("completed"),
      Type.Literal("deleted"),
    ]),
    activeForm: Type.Optional(
      Type.String({ minLength: 1, maxLength: 120 }),
    ),
    owner: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    blocks: Type.Array(
      Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }),
      { maxItems: 32 },
    ),
    blockedBy: Type.Array(
      Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }),
      { maxItems: 32 },
    ),
    metadata: Type.Record(
      Type.String({ minLength: 1, maxLength: 64 }),
      Type.Unknown(),
      { maxProperties: 16 },
    ),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const AgentWorkItemsUpdatedPayloadSchema = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    listId: Type.String({ minLength: 1, maxLength: 512 }),
    revision: Type.Integer({ minimum: 1 }),
    nextTaskSequence: Type.Integer({ minimum: 1 }),
    items: Type.Array(WorkItemItemSchema, { maxItems: 256 }),
    updatedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const AgentWorkItemsUpdatedSnapshotSchema = Type.Object(
  {
    runId: Type.String({ minLength: 1 }),
    turnId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: true },
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

/** 通用系统提醒附加事件负载 schema（kind/content/order）。Generic system-reminder attached payload schema. */
export const SystemReminderAttachedPayloadSchema = Type.Object(
  {
    reminderId: Type.String({ minLength: 1 }),
    kind: Type.Union(REMINDER_KIND.map((kind) => Type.Literal(kind))),
    content: Type.String({ minLength: 1 }),
    order: Type.Integer({ minimum: 0 }),
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
  toolName: Type.String({ pattern: "^[A-Z][A-Za-z0-9]{0,63}$" }),
  toolVersion: Type.String({ pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$" }),
  argumentDigest: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" }),
};
export const ToolApprovalRequestedPayloadSchema = Type.Object({
  ...ToolApprovalIdentityProperties,
  runtimeInstanceId: Type.String({ minLength: 1, maxLength: 256 }),
  summary: Type.Object({
    title: Type.String({ minLength: 1, maxLength: 256 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
    arguments: Type.Optional(Type.Any()),
    operations: Type.Optional(Type.Array(
      Type.Object({
        op: Type.Union([
          Type.Literal("add"),
          Type.Literal("edit"),
          Type.Literal("delete"),
        ]),
        kind: Type.String({ minLength: 1, maxLength: 64 }),
        id: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
        title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
      }, { additionalProperties: false }),
      { minItems: 1, maxItems: 64 },
    )),
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
export const ToolTraceRecordedPayloadSchema = Type.Object({
  traceId: Type.String({ minLength: 1, maxLength: 256 }),
  toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
  toolName: Type.String({ pattern: "^[A-Z][A-Za-z0-9]{0,63}$" }),
  toolVersion: Type.String({ pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$" }),
  argumentDigest: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" }),
  stage: Type.Union([
    Type.Literal("received"), Type.Literal("resolved"),
    Type.Literal("validated"), Type.Literal("permission_evaluated"),
    Type.Literal("approval_requested"), Type.Literal("approval_resolved"),
    Type.Literal("sandbox_started"), Type.Literal("execution_started"),
    Type.Literal("execution_completed"), Type.Literal("execution_failed"),
    Type.Literal("cancelled"), Type.Literal("timed_out"),
  ]),
  attempt: Type.Integer({ minimum: 1 }),
  durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
  inputBytes: Type.Optional(Type.Integer({ minimum: 0 })),
  outputBytes: Type.Optional(Type.Integer({ minimum: 0 })),
  ruleIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }))),
  permissionEffect: Type.Optional(Type.Union([
    Type.Literal("allow"), Type.Literal("ask"), Type.Literal("deny"),
  ])),
  approvalDecision: Type.Optional(Type.Union([
    Type.Literal("approved"), Type.Literal("rejected"),
    Type.Literal("cancelled"), Type.Literal("expired"),
  ])),
  approvalActorId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  artifactIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }))),
  errorCategory: Type.Optional(Type.Union([
    Type.Literal("validation"), Type.Literal("permission"),
    Type.Literal("approval_rejected"), Type.Literal("sandbox"),
    Type.Literal("timeout"), Type.Literal("cancelled"),
    Type.Literal("execution"), Type.Literal("internal"),
  ])),
  errorCode: Type.Optional(Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,127}$" })),
  retryable: Type.Optional(Type.Boolean()),
  sideEffectStatus: Type.Optional(Type.Union([
    Type.Literal("none"), Type.Literal("possible"),
    Type.Literal("partial"), Type.Literal("completed_unknown"),
  ])),
}, { additionalProperties: false });
export const ToolRequestRecordedPayloadSchema = Type.Object({
  toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
  toolName: Type.String({ pattern: "^[A-Z][A-Za-z0-9]{0,63}$" }),
  toolVersion: Type.String({ pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$" }),
  arguments: Type.Any(),
  truncated: Type.Boolean(),
}, { additionalProperties: false });
export const ToolResultRecordedPayloadSchema = Type.Object({
  toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
  toolName: Type.String({ pattern: "^[A-Z][A-Za-z0-9]{0,63}$" }),
  toolVersion: Type.String({ pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$" }),
  outcome: Type.Union([Type.Literal("ok"), Type.Literal("failed")]),
  result: Type.Optional(Type.Any()),
  errorCode: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  truncated: Type.Boolean(),
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

const SubagentArtifactReferenceSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    artifactId: Type.String({ minLength: 1 }),
    conversationId: Type.String({ minLength: 1 }),
    contentType: Type.String({ minLength: 1 }),
    byteLength: Type.Integer({ minimum: 0 }),
    digest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
    tokenEstimate: Type.Optional(Type.Integer({ minimum: 0 })),
    filename: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const SubagentIdentitySchema = {
  subagentId: Type.String({ minLength: 1 }),
  childConversationId: Type.String({ minLength: 1 }),
} as const;

export const SubagentStartedPayloadSchema = Type.Object(
  {
    ...SubagentIdentitySchema,
    agentType: Type.String({ minLength: 1 }),
    definitionVersion: Type.String({ minLength: 1 }),
    startedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const SubagentProgressPayloadSchema = Type.Object(
  {
    ...SubagentIdentitySchema,
    progressCode: Type.String({ pattern: "^[a-z][a-z0-9_.-]{0,127}$" }),
    ordinal: Type.Integer({ minimum: 1 }),
    reportedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const SubagentCompletedPayloadSchema = Type.Union([
  Type.Object(
    {
      ...SubagentIdentitySchema,
      summary: Type.String({ minLength: 1 }),
      artifactReferences: Type.Array(SubagentArtifactReferenceSchema),
      completedAt: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...SubagentIdentitySchema,
      artifactReferences: Type.Array(SubagentArtifactReferenceSchema, { minItems: 1 }),
      completedAt: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
]);

const SubagentCancellationReasonSchema = Type.Union([
  Type.Literal("parent_completed"),
  Type.Literal("parent_failed"),
  Type.Literal("parent_stopped"),
  Type.Literal("parent_crashed"),
  Type.Literal("explicit"),
  Type.Literal("limit_reclaimed"),
  Type.Literal("orphan_reclaimed"),
]);

export const SubagentFailedPayloadSchema = Type.Union([
  Type.Object(
    {
      ...SubagentIdentitySchema,
      outcome: Type.Literal("failed"),
      errorCode: Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,127}$" }),
      artifactReferences: Type.Array(SubagentArtifactReferenceSchema),
      failedAt: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...SubagentIdentitySchema,
      outcome: Type.Literal("orphaned"),
      cancellationReason: SubagentCancellationReasonSchema,
      artifactReferences: Type.Array(SubagentArtifactReferenceSchema),
      failedAt: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
]);

export const SubagentCancelledPayloadSchema = Type.Object(
  {
    ...SubagentIdentitySchema,
    cancellationReason: SubagentCancellationReasonSchema,
    artifactReferences: Type.Array(SubagentArtifactReferenceSchema),
    cancelledAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const SubagentLifecycleSnapshotSchema = Type.Object(
  {
    runId: Type.String({ minLength: 1 }),
    turnId: Type.Optional(Type.String({ minLength: 1 })),
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
    eventType: OUTPUT_EVENT_TYPE.agentTodoUpdated,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: AgentTodoUpdatedPayloadSchema,
    snapshotSchema: AgentTodoUpdatedSnapshotSchema,
  });

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.agentWorkItemsUpdated,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: AgentWorkItemsUpdatedPayloadSchema,
    snapshotSchema: AgentWorkItemsUpdatedSnapshotSchema,
  });

  for (const [eventType, payloadSchema] of [
    [OUTPUT_EVENT_TYPE.subagentStarted, SubagentStartedPayloadSchema],
    [OUTPUT_EVENT_TYPE.subagentProgress, SubagentProgressPayloadSchema],
    [OUTPUT_EVENT_TYPE.subagentCompleted, SubagentCompletedPayloadSchema],
    [OUTPUT_EVENT_TYPE.subagentFailed, SubagentFailedPayloadSchema],
    [OUTPUT_EVENT_TYPE.subagentCancelled, SubagentCancelledPayloadSchema],
  ] as const) {
    registry.register({
      kind: "output",
      eventType,
      schemaVersion: EVENT_SCHEMA_VERSION,
      payloadSchema,
      snapshotSchema: SubagentLifecycleSnapshotSchema,
    });
  }

  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.nudgeScheduled,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: NudgeScheduledPayloadSchema,
    snapshotSchema: NudgeLifecycleSnapshotSchema,
  });
  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.toolTraceRecorded,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: ToolTraceRecordedPayloadSchema,
    snapshotSchema: NudgeLifecycleSnapshotSchema,
  });
  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.toolRequestRecorded,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: ToolRequestRecordedPayloadSchema,
    snapshotSchema: NudgeLifecycleSnapshotSchema,
  });
  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.toolResultRecorded,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: ToolResultRecordedPayloadSchema,
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
    eventType: OUTPUT_EVENT_TYPE.systemReminderAttached,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: SystemReminderAttachedPayloadSchema,
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
  registerNovelLifecycleOutputEventSchemas(registry);
  registerNovelComposeOutputEventSchemas(registry);
  registerNovelModeOutputEventSchemas(registry);
}
