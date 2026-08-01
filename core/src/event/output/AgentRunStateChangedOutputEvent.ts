/** Records one Core-owned Run state transition for replay and UI consumers. */
import type { DurableInputEventReference } from "../input/DurableInputEventReference.js";
import type {
  RunStateChangeReason,
  RunStatus,
} from "../../runtime/execution/RunLifecycle.js";
import { AgentOutputEvent } from "./AgentOutputEvent.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import { AgentRunStateChangedPayload } from "./payload/AgentRunStateChangedPayload.js";

export interface AgentRunStateChangedOutputEventOptions
  extends Omit<OutputEventOptions, "runId" | "turnId"> {
  runId: string;
  inputEvent: DurableInputEventReference;
  previous: RunStatus | null;
  current: RunStatus;
  reason: RunStateChangeReason;
}

export class AgentRunStateChangedOutputEvent extends AgentOutputEvent {
  constructor(options: AgentRunStateChangedOutputEventOptions) {
    const { runId, inputEvent, previous, current, reason, ...eventOptions } = options;
    assertNonBlank("Run ID", runId);
    super(
      "run.state.changed",
      new AgentRunStateChangedPayload({ inputEvent, previous, current, reason }),
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

function assertNonBlank(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}
