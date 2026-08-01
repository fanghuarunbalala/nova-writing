/** Records one Core-owned Turn state transition mapped from an Agent adapter. */
import type {
  TurnStateChangeReason,
  TurnStatus,
} from "../../runtime/execution/TurnLifecycle.js";
import { AgentOutputEvent } from "./AgentOutputEvent.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import { AgentTurnStateChangedPayload } from "./payload/AgentTurnStateChangedPayload.js";

export interface AgentTurnStateChangedOutputEventOptions
  extends Omit<OutputEventOptions, "runId" | "turnId"> {
  runId: string;
  turnId: string;
  previous: TurnStatus | null;
  current: TurnStatus;
  reason: TurnStateChangeReason;
}

export class AgentTurnStateChangedOutputEvent extends AgentOutputEvent {
  constructor(options: AgentTurnStateChangedOutputEventOptions) {
    const { runId, turnId, previous, current, reason, ...eventOptions } = options;
    assertNonBlank("Run ID", runId);
    assertNonBlank("Turn ID", turnId);
    super(
      "turn.state.changed",
      new AgentTurnStateChangedPayload({ previous, current, reason }),
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

function assertNonBlank(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}
