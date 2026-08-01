/** Records one Core-owned Turn state transition mapped from an Agent adapter. */
import { AgentOutputEvent } from "./AgentOutputEvent.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import {
  AgentTurnStateChangedPayload,
  type AgentTurnStateChangedPayloadOptions,
} from "./payload/AgentTurnStateChangedPayload.js";

export type AgentTurnStateChangedOutputEventOptions = Omit<
  OutputEventOptions,
  "runId" | "turnId"
> &
  AgentTurnStateChangedPayloadOptions & {
    runId: string;
    turnId: string;
  };

export class AgentTurnStateChangedOutputEvent extends AgentOutputEvent {
  constructor(options: AgentTurnStateChangedOutputEventOptions) {
    const {
      runId,
      turnId,
      ...eventOptions
    } = options;
    assertNonBlank("Run ID", runId);
    assertNonBlank("Turn ID", turnId);
    super(
      "turn.state.changed",
      new AgentTurnStateChangedPayload(capturePayloadOptions(options)),
      {
        ...eventOptions,
        runId,
        turnId,
      },
    );
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.agentTurnStateChanged;
  }
}

function capturePayloadOptions(
  options: AgentTurnStateChangedOutputEventOptions,
): AgentTurnStateChangedPayloadOptions {
  const base = {
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
    throw new TypeError("Non-cancelled Turn must not contain a cancellation reason");
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
