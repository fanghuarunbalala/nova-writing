/** Classifies validated durable Inputs into preemptive Control or FIFO Turn lanes. */
import { INPUT_EVENT_TYPE } from "../../../event/input/InputEventType.js";
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";

export const RUNTIME_INPUT_LANE = {
  control: "control",
  turn: "turn",
} as const;

export type RuntimeInputLane =
  (typeof RUNTIME_INPUT_LANE)[keyof typeof RUNTIME_INPUT_LANE];

export interface RuntimeInputLanePolicy {
  resolve(event: PersistedInputEventSnapshot): RuntimeInputLane;
}

export class CoreRuntimeInputLanePolicy implements RuntimeInputLanePolicy {
  resolve(event: PersistedInputEventSnapshot): RuntimeInputLane {
    return event.eventType === INPUT_EVENT_TYPE.systemStop ||
      event.eventType === INPUT_EVENT_TYPE.reloadConfig
      ? RUNTIME_INPUT_LANE.control
      : RUNTIME_INPUT_LANE.turn;
  }
}
