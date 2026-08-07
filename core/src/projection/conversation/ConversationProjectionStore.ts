/** Replayable Conversation Event projection with strict ordering and duplicate suppression. */
import {
  ASSISTANT_MESSAGE_DELTA_CHANNEL,
  INPUT_EVENT_TYPE,
  OUTPUT_EVENT_TYPE,
  canonicalStringifyJson,
  isAgentTurnInputEventType,
  type AssistantMessageCompletionReason,
  type AssistantMessageFailureCode,
  type JsonValue,
  type ToolApprovalResolutionDecision,
} from "../../event/index.js";
import {
  validatePersistedConversationEventSnapshot,
  type PersistedConversationEventSnapshot,
} from "../../storage/index.js";
import {
  isRuntimePresenceState,
  type RuntimePresence,
} from "../../conversation/RuntimePresence.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  isExecutionCancellationReason,
  type ExecutionCancellationReason,
} from "../../runtime/execution/ExecutionCancellationReason.js";
import {
  isRunStateChangeReason,
  isRunStatus,
  type RunStateChangeReason,
  type RunStatus,
} from "../../runtime/execution/RunLifecycle.js";
import {
  isTurnStateChangeReason,
  isTurnStatus,
  type TurnStateChangeReason,
  type TurnStatus,
} from "../../runtime/execution/TurnLifecycle.js";
import type { ToolApprovalOperationSummary } from "../../event/output/payload/ToolApprovalLifecyclePayloads.js";
import {
  ConversationProjectionConversationMismatchError,
  ConversationProjectionEventIdentityConflictError,
  ConversationProjectionPayloadError,
  ConversationProjectionSequenceConflictError,
  ConversationProjectionSequenceGapError,
} from "./ConversationProjectionErrors.js";
import { summarizeConversationEvent } from "./ConversationEventSummary.js";
import type {
  AgentRunProjection,
  AgentTurnProjection,
  AssistantContentProjection,
  AssistantMessageProjection,
  AssistantMessageProjectionStatus,
  ConversationEventDescriptor,
  ConversationProjectionApplyResult,
  ConversationProjectionListener,
  ConversationProjectionSnapshot,
  ConversationTimelineItem,
  ToolApprovalProjection,
  ToolTraceSummaryProjection,
  UserMessageProjection,
} from "./ConversationProjectionTypes.js";

interface MutableAssistantProjection {
  assistantMessageId: string;
  runId: string;
  turnId: string;
  startedSequence: number;
  lastSequence: number;
  timestamp: string;
  status: AssistantMessageProjectionStatus;
  contentByIndex: Map<number, AssistantContentProjection>;
  lastDeltaOrdinal: number;
  completionReason?: AssistantMessageCompletionReason;
  hasToolCalls?: boolean;
  failureCode?: AssistantMessageFailureCode;
}

export interface ConversationProjectionStoreOptions {
  readonly conversationId: string;
  readonly logger?: Logger;
}

export class ConversationProjectionStore {
  readonly conversationId: string;

  private readonly logger: Logger;
  private readonly eventCanonicalBySequence = new Map<number, string>();
  private readonly eventSequenceById = new Map<string, number>();
  private readonly eventDescriptors: ConversationEventDescriptor[] = [];
  private readonly userMessages: UserMessageProjection[] = [];
  private readonly assistants = new Map<string, MutableAssistantProjection>();
  private readonly runs = new Map<string, AgentRunProjection>();
  private readonly turns = new Map<string, AgentTurnProjection>();
  private readonly approvals = new Map<string, ToolApprovalProjection>();
  private readonly toolTraces: ToolTraceSummaryProjection[] = [];
  private readonly listeners = new Set<ConversationProjectionListener>();
  private runtimePresence?: RuntimePresence;
  private revision = 0;
  private lastAppliedSequence = 0;
  private snapshot: ConversationProjectionSnapshot;

  constructor(options: ConversationProjectionStoreOptions) {
    this.conversationId = requireNonBlank(
      "Conversation projection id",
      options.conversationId,
    );
    this.logger = (options.logger ?? noopLogger).child({
      component: "conversation_projection_store",
      conversationId: this.conversationId,
    });
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot(): ConversationProjectionSnapshot {
    return this.snapshot;
  }

  subscribe(listener: ConversationProjectionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  apply(event: PersistedConversationEventSnapshot): ConversationProjectionApplyResult {
    if (event.conversationId !== this.conversationId) {
      throw new ConversationProjectionConversationMismatchError(
        this.conversationId,
        event.conversationId,
      );
    }
    let validated: PersistedConversationEventSnapshot;
    try {
      validated = validatePersistedConversationEventSnapshot(
        event,
        this.conversationId,
      );
    } catch {
      throw payloadError(event.eventType, "Persisted Event snapshot is invalid");
    }
    // 流式 delta：只叠加内容，不校验/不推进 journal sequence（delta 不落盘）。
    if (validated.eventType === OUTPUT_EVENT_TYPE.agentAssistantMessageDelta) {
      this.applyTypedProjection(validated);
      this.snapshot = this.buildSnapshot();
      this.notifyListeners();
      return "applied";
    }
    const canonical = canonicalStringifyJson(validated as unknown as JsonValue);
    const appliedCanonical = this.eventCanonicalBySequence.get(validated.sequence);
    if (appliedCanonical !== undefined) {
      if (appliedCanonical === canonical) {
        this.logger.debug("conversation.projection.event_duplicate", {
          eventId: validated.id,
          eventType: validated.eventType,
          sequence: validated.sequence,
        });
        return "duplicate";
      }
      throw new ConversationProjectionSequenceConflictError(validated.sequence);
    }

    const expectedSequence = this.lastAppliedSequence + 1;
    if (validated.sequence !== expectedSequence) {
      throw new ConversationProjectionSequenceGapError(
        expectedSequence,
        validated.sequence,
      );
    }
    const existingSequence = this.eventSequenceById.get(validated.id);
    if (existingSequence !== undefined) {
      throw new ConversationProjectionEventIdentityConflictError(validated.id);
    }

    this.applyTypedProjection(validated);
    this.eventDescriptors.push(createEventDescriptor(validated));
    this.eventCanonicalBySequence.set(validated.sequence, canonical);
    this.eventSequenceById.set(validated.id, validated.sequence);
    this.lastAppliedSequence = validated.sequence;
    this.revision += 1;
    this.snapshot = this.buildSnapshot();
    this.logger.debug("conversation.projection.event_applied", {
      eventId: validated.id,
      eventType: validated.eventType,
      direction: validated.direction,
      sequence: validated.sequence,
      revision: this.revision,
    });
    this.notifyListeners();
    return "applied";
  }

  applyMany(
    events: readonly PersistedConversationEventSnapshot[],
  ): readonly ConversationProjectionApplyResult[] {
    return Object.freeze(events.map((event) => this.apply(event)));
  }

  private applyTypedProjection(event: PersistedConversationEventSnapshot): void {
    if (event.direction === "input" && isAgentTurnInputEventType(event.eventType)) {
      this.applyUserMessage(event);
      return;
    }
    if (event.direction !== "output") return;

    switch (event.eventType) {
      case OUTPUT_EVENT_TYPE.runtimePresenceChanged:
        this.applyRuntimePresence(event);
        return;
      case OUTPUT_EVENT_TYPE.agentRunStateChanged:
        this.applyRunState(event);
        return;
      case OUTPUT_EVENT_TYPE.agentTurnStateChanged:
        this.applyTurnState(event);
        return;
      case OUTPUT_EVENT_TYPE.agentAssistantMessageStarted:
        this.applyAssistantStarted(event);
        return;
      case OUTPUT_EVENT_TYPE.agentAssistantMessageDelta:
        this.applyAssistantDelta(event);
        return;
      case OUTPUT_EVENT_TYPE.agentAssistantMessageCompleted:
        this.applyAssistantCompleted(event);
        return;
      case OUTPUT_EVENT_TYPE.agentAssistantMessageFailed:
        this.applyAssistantTerminal(event, "failed");
        return;
      case OUTPUT_EVENT_TYPE.agentAssistantMessageCancelled:
        this.applyAssistantTerminal(event, "cancelled");
        return;
      case OUTPUT_EVENT_TYPE.toolApprovalRequested:
        this.applyApprovalRequested(event);
        return;
      case OUTPUT_EVENT_TYPE.toolApprovalResolved:
        this.applyApprovalResolved(event);
        return;
      case OUTPUT_EVENT_TYPE.toolTraceRecorded:
        this.applyToolTrace(event);
        return;
      default:
        return;
    }
  }

  private applyToolTrace(event: PersistedConversationEventSnapshot): void {
    const payload = payloadRecord(event);
    const runId = requireEventIdentity(event.eventType, "runId", event.runId);
    const traceId = requireString(event.eventType, "traceId", payload.traceId);
    const toolName = requireString(event.eventType, "toolName", payload.toolName);
    const stage = typeof payload.stage === "string" ? payload.stage : undefined;
    const durationMs =
      typeof payload.durationMs === "number" ? payload.durationMs : undefined;
    const outcome: "ok" | "failed" =
      payload.errorCategory === undefined ? "ok" : "failed";
    this.toolTraces.push(
      Object.freeze({
        traceId,
        toolName,
        ...(stage === undefined ? {} : { stage }),
        outcome,
        ...(durationMs === undefined ? {} : { durationMs }),
        runId,
        ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
        sequence: event.sequence,
        timestamp: event.timestamp,
      }),
    );
  }

  private applyUserMessage(event: PersistedConversationEventSnapshot): void {
    const payload = payloadRecord(event);
    this.userMessages.push(
      Object.freeze({
        kind: "user-message",
        eventId: event.id,
        sequence: event.sequence,
        timestamp: event.timestamp,
        text: requireString(
          event.eventType,
          event.eventType === INPUT_EVENT_TYPE.taskAssigned ? "prompt" : "text",
          event.eventType === INPUT_EVENT_TYPE.taskAssigned
            ? payload.prompt
            : payload.text,
        ),
        ...(event.runId !== undefined ? { runId: event.runId } : {}),
        ...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
      }),
    );
  }

  private applyRuntimePresence(event: PersistedConversationEventSnapshot): void {
    const payload = payloadRecord(event);
    const current = requireRecord(event.eventType, "current", payload.current);
    if (!isRuntimePresenceState(current.state)) {
      throw payloadError(event.eventType, "current.state is invalid");
    }
    this.runtimePresence = Object.freeze({
      state: current.state,
      observedAt: requireString(
        event.eventType,
        "current.observedAt",
        current.observedAt,
      ),
    });
  }

  private applyRunState(event: PersistedConversationEventSnapshot): void {
    const runId = requireEventIdentity(event.eventType, "runId", event.runId);
    const payload = payloadRecord(event);
    const inputEvent = requireRecord(event.eventType, "inputEvent", payload.inputEvent);
    const previous = parseNullableRunStatus(event.eventType, payload.previous);
    if (!isRunStatus(payload.current)) {
      throw payloadError(event.eventType, "current Run status is invalid");
    }
    if (!isRunStateChangeReason(payload.reason)) {
      throw payloadError(event.eventType, "Run state reason is invalid");
    }
    const cancellationReason = parseCancellationReason(
      event.eventType,
      payload.cancellationReason,
    );
    const existing = this.runs.get(runId);
    if ((existing?.current ?? null) !== previous) {
      throw payloadError(event.eventType, "previous Run status does not match projection");
    }
    this.runs.set(
      runId,
      Object.freeze({
        runId,
        inputEventId: requireString(event.eventType, "inputEvent.id", inputEvent.id),
        inputEventType: requireString(
          event.eventType,
          "inputEvent.eventType",
          inputEvent.eventType,
        ),
        inputEventSequence: requireInteger(
          event.eventType,
          "inputEvent.sequence",
          inputEvent.sequence,
          1,
        ),
        previous,
        current: payload.current,
        reason: payload.reason,
        ...(cancellationReason !== undefined ? { cancellationReason } : {}),
        lastSequence: event.sequence,
      }),
    );
  }

  private applyTurnState(event: PersistedConversationEventSnapshot): void {
    const runId = requireEventIdentity(event.eventType, "runId", event.runId);
    const turnId = requireEventIdentity(event.eventType, "turnId", event.turnId);
    const payload = payloadRecord(event);
    const previous = parseNullableTurnStatus(event.eventType, payload.previous);
    if (!isTurnStatus(payload.current)) {
      throw payloadError(event.eventType, "current Turn status is invalid");
    }
    if (!isTurnStateChangeReason(payload.reason)) {
      throw payloadError(event.eventType, "Turn state reason is invalid");
    }
    const cancellationReason = parseCancellationReason(
      event.eventType,
      payload.cancellationReason,
    );
    const existing = this.turns.get(turnId);
    if ((existing?.current ?? null) !== previous) {
      throw payloadError(event.eventType, "previous Turn status does not match projection");
    }
    this.turns.set(
      turnId,
      Object.freeze({
        runId,
        turnId,
        previous,
        current: payload.current,
        reason: payload.reason,
        ...(cancellationReason !== undefined ? { cancellationReason } : {}),
        lastSequence: event.sequence,
      }),
    );
  }

  private applyAssistantStarted(event: PersistedConversationEventSnapshot): void {
    const payload = payloadRecord(event);
    const assistantMessageId = requireString(
      event.eventType,
      "assistantMessageId",
      payload.assistantMessageId,
    );
    if (this.assistants.has(assistantMessageId)) {
      throw payloadError(event.eventType, "Assistant Message already exists");
    }
    this.assistants.set(assistantMessageId, {
      assistantMessageId,
      runId: requireEventIdentity(event.eventType, "runId", event.runId),
      turnId: requireEventIdentity(event.eventType, "turnId", event.turnId),
      startedSequence: event.sequence,
      lastSequence: event.sequence,
      timestamp: event.timestamp,
      status: "streaming",
      contentByIndex: new Map(),
      lastDeltaOrdinal: -1,
    });
  }

  private applyAssistantDelta(event: PersistedConversationEventSnapshot): void {
    const payload = payloadRecord(event);
    const assistant = this.requireStreamingAssistant(event, payload);
    const deltaOrdinal = requireInteger(
      event.eventType,
      "deltaOrdinal",
      payload.deltaOrdinal,
      0,
    );
    if (deltaOrdinal !== assistant.lastDeltaOrdinal + 1) {
      throw payloadError(event.eventType, "Assistant delta ordinal is not contiguous");
    }
    const contentIndex = requireInteger(
      event.eventType,
      "contentIndex",
      payload.contentIndex,
      0,
    );
    const channel = payload.channel;
    if (
      channel !== ASSISTANT_MESSAGE_DELTA_CHANNEL.text &&
      channel !== ASSISTANT_MESSAGE_DELTA_CHANNEL.thinking
    ) {
      throw payloadError(event.eventType, "Assistant delta channel is invalid");
    }
    const delta = requireString(event.eventType, "delta", payload.delta, false);
    const existing = assistant.contentByIndex.get(contentIndex);
    if (channel === "text") {
      if (existing !== undefined && existing.type !== "text") {
        throw payloadError(event.eventType, "Assistant content channel changed");
      }
      assistant.contentByIndex.set(
        contentIndex,
        Object.freeze({
          type: "text",
          text: `${existing?.type === "text" ? existing.text : ""}${delta}`,
        }),
      );
    } else {
      if (existing !== undefined && existing.type !== "thinking") {
        throw payloadError(event.eventType, "Assistant content channel changed");
      }
      assistant.contentByIndex.set(
        contentIndex,
        Object.freeze({
          type: "thinking",
          thinking: `${
            existing?.type === "thinking" ? existing.thinking : ""
          }${delta}`,
        }),
      );
    }
    assistant.lastDeltaOrdinal = deltaOrdinal;
    assistant.lastSequence = event.sequence;
  }

  private applyAssistantCompleted(event: PersistedConversationEventSnapshot): void {
    const payload = payloadRecord(event);
    const assistant = this.requireStreamingAssistant(event, payload);
    const content = requireArray(event.eventType, "content", payload.content).map(
      (item, index) => parseAssistantContent(event.eventType, item, index),
    );
    const completionReason = payload.completionReason;
    if (
      completionReason !== "stop" &&
      completionReason !== "length" &&
      completionReason !== "tool_use"
    ) {
      throw payloadError(event.eventType, "Assistant completion reason is invalid");
    }
    const hasToolCalls = requireBoolean(
      event.eventType,
      "hasToolCalls",
      payload.hasToolCalls,
    );
    assistant.contentByIndex = new Map(content.map((item, index) => [index, item]));
    assistant.status = "completed";
    assistant.completionReason = completionReason;
    assistant.hasToolCalls = hasToolCalls;
    assistant.lastSequence = event.sequence;
  }

  private applyAssistantTerminal(
    event: PersistedConversationEventSnapshot,
    status: "failed" | "cancelled",
  ): void {
    const payload = payloadRecord(event);
    const assistant = this.requireStreamingAssistant(event, payload);
    if (status === "failed") {
      const failureCode = payload.failureCode;
      if (failureCode !== "provider_error" && failureCode !== "provider_aborted") {
        throw payloadError(event.eventType, "Assistant failure code is invalid");
      }
      assistant.failureCode = failureCode;
    }
    assistant.status = status;
    assistant.lastSequence = event.sequence;
  }

  private requireStreamingAssistant(
    event: PersistedConversationEventSnapshot,
    payload: Record<string, unknown>,
  ): MutableAssistantProjection {
    const assistantMessageId = requireString(
      event.eventType,
      "assistantMessageId",
      payload.assistantMessageId,
    );
    const assistant = this.assistants.get(assistantMessageId);
    if (assistant === undefined || assistant.status !== "streaming") {
      throw payloadError(event.eventType, "Assistant Message is not streaming");
    }
    if (assistant.runId !== event.runId || assistant.turnId !== event.turnId) {
      throw payloadError(event.eventType, "Assistant Message identity changed");
    }
    return assistant;
  }

  private applyApprovalRequested(event: PersistedConversationEventSnapshot): void {
    const runId = requireEventIdentity(event.eventType, "runId", event.runId);
    const payload = payloadRecord(event);
    const approvalRequestId = requireString(
      event.eventType,
      "approvalRequestId",
      payload.approvalRequestId,
    );
    if (this.approvals.has(approvalRequestId)) {
      throw payloadError(event.eventType, "Tool Approval already exists");
    }
    const summary = requireRecord(event.eventType, "summary", payload.summary);
    this.approvals.set(
      approvalRequestId,
      Object.freeze({
        kind: "tool-approval",
        approvalRequestId,
        toolCallId: requireString(event.eventType, "toolCallId", payload.toolCallId),
        toolName: requireString(event.eventType, "toolName", payload.toolName),
        toolVersion: requireString(event.eventType, "toolVersion", payload.toolVersion),
        argumentDigest: requireDigest(event.eventType, payload.argumentDigest),
        runId,
        ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
        requestedSequence: event.sequence,
        lastSequence: event.sequence,
        title: requireString(event.eventType, "summary.title", summary.title),
        ...(summary.description !== undefined
          ? {
              description: requireString(
                event.eventType,
                "summary.description",
                summary.description,
              ),
            }
          : {}),
        ...(summary.arguments === undefined
          ? {}
          : { arguments: requireJsonValue(event.eventType, "summary.arguments", summary.arguments) }),
        ...(summary.operations === undefined
          ? {}
          : { operations: requireApprovalOperations(event.eventType, summary.operations) }),
        requestedAt: requireString(
          event.eventType,
          "requestedAt",
          payload.requestedAt,
        ),
        expiresAt: requireString(event.eventType, "expiresAt", payload.expiresAt),
        status: "pending",
      }),
    );
  }

  private applyApprovalResolved(event: PersistedConversationEventSnapshot): void {
    const payload = payloadRecord(event);
    const approvalRequestId = requireString(
      event.eventType,
      "approvalRequestId",
      payload.approvalRequestId,
    );
    const approval = this.approvals.get(approvalRequestId);
    if (approval === undefined || approval.status !== "pending") {
      throw payloadError(event.eventType, "Tool Approval is not pending");
    }
    if (
      approval.runId !== event.runId ||
      approval.toolCallId !== payload.toolCallId ||
      approval.toolName !== payload.toolName ||
      approval.toolVersion !== payload.toolVersion ||
      approval.argumentDigest !== payload.argumentDigest
    ) {
      throw payloadError(event.eventType, "Tool Approval identity changed");
    }
    const decision = parseApprovalDecision(event.eventType, payload.decision);
    // 决议后只保留摘要，裁掉完整参数（避免投影长期累积大内容）。
    const { arguments: droppedArguments, ...summaryFields } = approval;
    void droppedArguments;
    this.approvals.set(
      approvalRequestId,
      Object.freeze({
        ...summaryFields,
        lastSequence: event.sequence,
        status: decision,
        ...(payload.actorId !== undefined
          ? {
              actorId: requireString(event.eventType, "actorId", payload.actorId),
            }
          : {}),
        resolvedAt: requireString(event.eventType, "resolvedAt", payload.resolvedAt),
      }),
    );
  }

  private buildSnapshot(): ConversationProjectionSnapshot {
    const assistantMessages = [...this.assistants.values()]
      .sort((left, right) => left.startedSequence - right.startedSequence)
      .map(toAssistantProjection);
    const approvals = [...this.approvals.values()].sort(
      (left, right) => left.requestedSequence - right.requestedSequence,
    );
    const timeline = [
      ...this.userMessages,
      ...assistantMessages,
      ...approvals,
    ].sort((left, right) => timelineSequence(left) - timelineSequence(right));
    return Object.freeze({
      conversationId: this.conversationId,
      revision: this.revision,
      lastAppliedSequence: this.lastAppliedSequence,
      events: Object.freeze([...this.eventDescriptors]),
      toolTraces: Object.freeze([...this.toolTraces]),
      timeline: Object.freeze(timeline),
      userMessages: Object.freeze([...this.userMessages]),
      assistantMessages: Object.freeze(assistantMessages),
      approvals: Object.freeze(approvals),
      runs: Object.freeze(
        [...this.runs.values()].sort(
          (left, right) => left.lastSequence - right.lastSequence,
        ),
      ),
      turns: Object.freeze(
        [...this.turns.values()].sort(
          (left, right) => left.lastSequence - right.lastSequence,
        ),
      ),
      ...(this.runtimePresence !== undefined
        ? { runtimePresence: this.runtimePresence }
        : {}),
    });
  }

  private notifyListeners(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.logger.error("conversation.projection.listener_failed", {
          errorName: getErrorName(error),
        });
      }
    }
  }
}

function createEventDescriptor(
  event: PersistedConversationEventSnapshot,
): ConversationEventDescriptor {
  const summary = summarizeConversationEvent(event);
  return Object.freeze({
    eventId: event.id,
    sequence: event.sequence,
    direction: event.direction,
    eventType: event.eventType,
    ...(summary === undefined ? {} : { summary }),
    timestamp: event.timestamp,
    recordedAt: event.recordedAt,
    ...(event.runId !== undefined ? { runId: event.runId } : {}),
    ...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
  });
}

function toAssistantProjection(
  assistant: MutableAssistantProjection,
): AssistantMessageProjection {
  const content = [...assistant.contentByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, item]) => item);
  return Object.freeze({
    kind: "assistant-message",
    assistantMessageId: assistant.assistantMessageId,
    runId: assistant.runId,
    turnId: assistant.turnId,
    startedSequence: assistant.startedSequence,
    lastSequence: assistant.lastSequence,
    timestamp: assistant.timestamp,
    status: assistant.status,
    content: Object.freeze(content),
    ...(assistant.completionReason !== undefined
      ? { completionReason: assistant.completionReason }
      : {}),
    ...(assistant.hasToolCalls !== undefined
      ? { hasToolCalls: assistant.hasToolCalls }
      : {}),
    ...(assistant.failureCode !== undefined
      ? { failureCode: assistant.failureCode }
      : {}),
  });
}

function timelineSequence(item: ConversationTimelineItem): number {
  if (item.kind === "user-message") return item.sequence;
  if (item.kind === "assistant-message") return item.startedSequence;
  return item.requestedSequence;
}

function payloadRecord(event: PersistedConversationEventSnapshot): Record<string, unknown> {
  return requireRecord(event.eventType, "payload", event.payload);
}

function requireRecord(
  eventType: string,
  label: string,
  value: unknown,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw payloadError(eventType, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(eventType: string, label: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw payloadError(eventType, `${label} must be an array`);
  }
  return value;
}

function requireJsonValue(
  eventType: string,
  label: string,
  value: unknown,
): JsonValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value as JsonValue;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => requireJsonValue(eventType, label, item))) as JsonValue;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      result[key] = requireJsonValue(eventType, label, item);
    }
    return Object.freeze(result) as JsonValue;
  }
  throw payloadError(eventType, `${label} must be a JSON value`);
}

function requireApprovalOperations(
  eventType: string,
  value: unknown,
): readonly ToolApprovalOperationSummary[] {
  const operations = requireArray(eventType, "summary.operations", value);
  return Object.freeze(
    operations.map((item, index) => {
      const record = requireRecord(
        eventType,
        `summary.operations[${index}]`,
        item,
      );
      const op = record.op;
      if (op !== "add" && op !== "edit" && op !== "delete") {
        throw payloadError(eventType, `summary.operations[${index}].op is invalid`);
      }
      return Object.freeze({
        op,
        kind: requireString(eventType, `summary.operations[${index}].kind`, record.kind),
        ...(record.id === undefined
          ? {}
          : { id: requireString(eventType, `summary.operations[${index}].id`, record.id) }),
        ...(record.title === undefined
          ? {}
          : { title: requireString(eventType, `summary.operations[${index}].title`, record.title) }),
      });
    }),
  );
}

function requireString(
  eventType: string,
  label: string,
  value: unknown,
  nonBlank = true,
): string {
  if (
    typeof value !== "string" ||
    (nonBlank ? value.trim().length === 0 : value.length === 0)
  ) {
    throw payloadError(eventType, `${label} must be a string`);
  }
  return value;
}

function requireBoolean(eventType: string, label: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw payloadError(eventType, `${label} must be a boolean`);
  }
  return value;
}

function requireInteger(
  eventType: string,
  label: string,
  value: unknown,
  minimum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw payloadError(eventType, `${label} must be a valid integer`);
  }
  return value as number;
}

function requireEventIdentity(
  eventType: string,
  label: string,
  value: string | undefined,
): string {
  return requireString(eventType, label, value);
}

function requireDigest(eventType: string, value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw payloadError(eventType, "argumentDigest is invalid");
  }
  return value as `sha256:${string}`;
}

function parseAssistantContent(
  eventType: string,
  value: unknown,
  index: number,
): AssistantContentProjection {
  const content = requireRecord(eventType, `content[${index}]`, value);
  if (content.type === "text") {
    return Object.freeze({
      type: "text",
      text: requireString(eventType, `content[${index}].text`, content.text, false),
    });
  }
  if (content.type === "thinking") {
    return Object.freeze({
      type: "thinking",
      thinking: requireString(
        eventType,
        `content[${index}].thinking`,
        content.thinking,
        false,
      ),
      ...(content.redacted !== undefined
        ? {
            redacted: requireBoolean(
              eventType,
              `content[${index}].redacted`,
              content.redacted,
            ),
          }
        : {}),
    });
  }
  throw payloadError(eventType, `content[${index}].type is invalid`);
}

function parseNullableRunStatus(eventType: string, value: unknown): RunStatus | null {
  if (value === null) return null;
  if (!isRunStatus(value)) throw payloadError(eventType, "previous Run status is invalid");
  return value;
}

function parseNullableTurnStatus(eventType: string, value: unknown): TurnStatus | null {
  if (value === null) return null;
  if (!isTurnStatus(value)) {
    throw payloadError(eventType, "previous Turn status is invalid");
  }
  return value;
}

function parseCancellationReason(
  eventType: string,
  value: unknown,
): ExecutionCancellationReason | undefined {
  if (value === undefined) return undefined;
  if (!isExecutionCancellationReason(value)) {
    throw payloadError(eventType, "cancellationReason is invalid");
  }
  return value;
}

function parseApprovalDecision(
  eventType: string,
  value: unknown,
): ToolApprovalResolutionDecision {
  if (
    value !== "approved" &&
    value !== "rejected" &&
    value !== "cancelled" &&
    value !== "expired"
  ) {
    throw payloadError(eventType, "Tool Approval decision is invalid");
  }
  return value;
}

function requireNonBlank(label: string, value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
  return value;
}

function payloadError(eventType: string, detail: string): ConversationProjectionPayloadError {
  return new ConversationProjectionPayloadError(eventType, detail);
}

function getErrorName(error: unknown): string {
  if (error === null || typeof error !== "object") return "UnknownError";
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && name.trim().length > 0
    ? name
    : "UnknownError";
}
