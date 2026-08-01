/** Records one Core-owned Run state transition for replay and UI consumers. */
import { AgentOutputEvent } from "./AgentOutputEvent.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import {
  AgentRunStateChangedPayload,
  type AgentRunStateChangedPayloadOptions,
} from "./payload/AgentRunStateChangedPayload.js";

export type AgentRunStateChangedOutputEventOptions = Omit<
  OutputEventOptions,
  "runId" | "turnId"
> &
  AgentRunStateChangedPayloadOptions & {
    runId: string;
  };

export class AgentRunStateChangedOutputEvent extends AgentOutputEvent {
  constructor(options: AgentRunStateChangedOutputEventOptions) {
    const {
      runId,
      ...eventOptions
    } = options;
    assertNonBlank("Run ID", runId);
    super(
      "run.state.changed",
      new AgentRunStateChangedPayload(capturePayloadOptions(options)),
      {
        ...eventOptions,
        runId,
      },
    );
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.agentRunStateChanged;
  }
}

function capturePayloadOptions(
  options: AgentRunStateChangedOutputEventOptions,
): AgentRunStateChangedPayloadOptions {
  const base = {
    inputEvent: options.inputEvent,
    previous: options.previous,
    reason: options.reason,
  };
  if (options.current === "cancelled") {
    return {
      ...base,
      current: options.current,
      cancellationReason: options.cancellationReason,
    };
  }
  if ("cancellationReason" in options && options.cancellationReason !== undefined) {
    throw new TypeError("Non-cancelled Run must not contain a cancellation reason");
  }
  return {
    ...base,
    current: options.current,
  };
}

function assertNonBlank(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}
