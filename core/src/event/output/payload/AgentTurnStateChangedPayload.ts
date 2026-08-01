/** Durable, replayable Turn state transition without Pi lifecycle objects. */
import type { JsonObject } from "../../protocol/JsonValue.js";
import {
  isTurnStateChangeReason,
  isTurnStatus,
  type TurnStateChangeReason,
  type TurnStatus,
} from "../../../runtime/execution/TurnLifecycle.js";
import {
  isExecutionCancellationReason,
  type ExecutionCancellationReason,
} from "../../../runtime/execution/ExecutionCancellationReason.js";
import { OutputPayload } from "../OutputPayload.js";

interface AgentTurnStateChangedPayloadBaseOptions {
  previous: TurnStatus | null;
  reason: TurnStateChangeReason;
}

export type AgentTurnStateChangedPayloadOptions = AgentTurnStateChangedPayloadBaseOptions &
  (
    | {
        current: "cancelled";
        cancellationReason: ExecutionCancellationReason;
      }
    | {
        current: Exclude<TurnStatus, "cancelled">;
        cancellationReason?: never;
      }
  );

export class AgentTurnStateChangedPayload extends OutputPayload {
  readonly previous: TurnStatus | null;
  readonly current: TurnStatus;
  readonly reason: TurnStateChangeReason;
  readonly cancellationReason?: ExecutionCancellationReason;

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
    if (options.current === "cancelled") {
      if (!isExecutionCancellationReason(options.cancellationReason)) {
        throw new TypeError("Cancelled Turn requires a registered cancellation reason");
      }
      this.cancellationReason = options.cancellationReason;
    } else if ("cancellationReason" in options && options.cancellationReason !== undefined) {
      throw new TypeError("Non-cancelled Turn must not contain a cancellation reason");
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
      ...(this.cancellationReason !== undefined
        ? { cancellationReason: this.cancellationReason }
        : {}),
    };
  }
}
