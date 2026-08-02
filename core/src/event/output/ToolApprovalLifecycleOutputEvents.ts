/** Public redacted OutputEvents for requested and resolved Tool approvals. */
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import { SystemOutputEvent } from "./SystemOutputEvent.js";
import {
  ToolApprovalRequestedPayload,
  ToolApprovalResolvedPayload,
  type ToolApprovalRequestedPayloadOptions,
  type ToolApprovalResolvedPayloadOptions,
} from "./payload/ToolApprovalLifecyclePayloads.js";

type RequiredRunOutputOptions = Omit<OutputEventOptions, "runId"> & {
  readonly runId: string;
};

export type ToolApprovalRequestedOutputEventOptions = RequiredRunOutputOptions &
  ToolApprovalRequestedPayloadOptions;

export class ToolApprovalRequestedOutputEvent extends SystemOutputEvent {
  constructor(options: ToolApprovalRequestedOutputEventOptions) {
    const { runId, ...eventOptions } = options;
    super("tool.approval.requested", new ToolApprovalRequestedPayload(options), {
      ...eventOptions,
      runId,
      timestamp: eventOptions.timestamp ?? options.requestedAt,
    });
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.toolApprovalRequested;
  }
}

export type ToolApprovalResolvedOutputEventOptions = RequiredRunOutputOptions &
  ToolApprovalResolvedPayloadOptions;

export class ToolApprovalResolvedOutputEvent extends SystemOutputEvent {
  constructor(options: ToolApprovalResolvedOutputEventOptions) {
    const { runId, ...eventOptions } = options;
    super("tool.approval.resolved", new ToolApprovalResolvedPayload(options), {
      ...eventOptions,
      runId,
      timestamp: eventOptions.timestamp ?? options.resolvedAt,
    });
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.toolApprovalResolved;
  }
}
