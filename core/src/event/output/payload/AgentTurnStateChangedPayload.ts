/** Durable, replayable Turn state transition without Pi lifecycle objects. */
import type { JsonObject } from "../../protocol/JsonValue.js";
import {
  isTurnStateChangeReason,
  isTurnStatus,
  type TurnStateChangeReason,
  type TurnStatus,
} from "../../../runtime/execution/TurnLifecycle.js";
import { OutputPayload } from "../OutputPayload.js";

export interface AgentTurnStateChangedPayloadOptions {
  previous: TurnStatus | null;
  current: TurnStatus;
  reason: TurnStateChangeReason;
}

export class AgentTurnStateChangedPayload extends OutputPayload {
  readonly previous: TurnStatus | null;
  readonly current: TurnStatus;
  readonly reason: TurnStateChangeReason;

  constructor(options: AgentTurnStateChangedPayloadOptions) {
    super();
    if (options.previous !== null && !isTurnStatus(options.previous)) {
      throw new TypeError("Previous Turn status must be null or a registered status");
    }
    if (!isTurnStatus(options.current)) {
      throw new TypeError("Current Turn status must be registered");
    }
    if (!isTurnStateChangeReason(options.reason)) {
      throw new TypeError("Turn state change reason must be registered");
    }

    this.previous = options.previous;
    this.current = options.current;
    this.reason = options.reason;
  }

  toObject(): JsonObject {
    return {
      previous: this.previous,
      current: this.current,
      reason: this.reason,
    };
  }
}
