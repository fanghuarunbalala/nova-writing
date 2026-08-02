/** Parent Conversation OutputEvents for redacted child lifecycle projection. */
import { AgentOutputEvent } from "./AgentOutputEvent.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import { SubagentCancelledPayload, SubagentCompletedPayload, SubagentFailedPayload, SubagentProgressPayload, SubagentStartedPayload, type SubagentCancelledPayloadOptions, type SubagentCompletedPayloadOptions, type SubagentFailedPayloadOptions, type SubagentProgressPayloadOptions, type SubagentStartedPayloadOptions } from "./payload/SubagentLifecyclePayloads.js";

type ParentRunEventOptions<T> = Omit<OutputEventOptions, "runId" | "turnId"> & T & { readonly runId: string; readonly turnId?: string };

export class SubagentStartedOutputEvent extends AgentOutputEvent {
  constructor(options: ParentRunEventOptions<SubagentStartedPayloadOptions>) { const { runId, turnId, ...eventOptions } = options; super("subagent.started", new SubagentStartedPayload(options), { ...eventOptions, runId, ...(turnId === undefined ? {} : { turnId }), timestamp: eventOptions.timestamp ?? options.startedAt }); }
  override getEventType(): string { return OUTPUT_EVENT_TYPE.subagentStarted; }
}
export class SubagentProgressOutputEvent extends AgentOutputEvent {
  constructor(options: ParentRunEventOptions<SubagentProgressPayloadOptions>) { const { runId, turnId, ...eventOptions } = options; super("subagent.progress", new SubagentProgressPayload(options), { ...eventOptions, runId, ...(turnId === undefined ? {} : { turnId }), timestamp: eventOptions.timestamp ?? options.reportedAt }); }
  override getEventType(): string { return OUTPUT_EVENT_TYPE.subagentProgress; }
}
export class SubagentCompletedOutputEvent extends AgentOutputEvent {
  constructor(options: ParentRunEventOptions<SubagentCompletedPayloadOptions>) { const { runId, turnId, ...eventOptions } = options; super("subagent.completed", new SubagentCompletedPayload(options), { ...eventOptions, runId, ...(turnId === undefined ? {} : { turnId }), timestamp: eventOptions.timestamp ?? options.completedAt }); }
  override getEventType(): string { return OUTPUT_EVENT_TYPE.subagentCompleted; }
}
export class SubagentFailedOutputEvent extends AgentOutputEvent {
  constructor(options: ParentRunEventOptions<SubagentFailedPayloadOptions>) { const { runId, turnId, ...eventOptions } = options; super("subagent.failed", new SubagentFailedPayload(options), { ...eventOptions, runId, ...(turnId === undefined ? {} : { turnId }), timestamp: eventOptions.timestamp ?? options.failedAt }); }
  override getEventType(): string { return OUTPUT_EVENT_TYPE.subagentFailed; }
}
export class SubagentCancelledOutputEvent extends AgentOutputEvent {
  constructor(options: ParentRunEventOptions<SubagentCancelledPayloadOptions>) { const { runId, turnId, ...eventOptions } = options; super("subagent.cancelled", new SubagentCancelledPayload(options), { ...eventOptions, runId, ...(turnId === undefined ? {} : { turnId }), timestamp: eventOptions.timestamp ?? options.cancelledAt }); }
  override getEventType(): string { return OUTPUT_EVENT_TYPE.subagentCancelled; }
}
