/** Durable, replayable Run state transition without Provider-specific state. */
import {
  captureDurableInputEventReference,
  type DurableInputEventReference,
} from "../../input/DurableInputEventReference.js";
import type { JsonObject } from "../../protocol/JsonValue.js";
import {
  isRunStateChangeReason,
  isRunStatus,
  type RunStateChangeReason,
  type RunStatus,
} from "../../../runtime/execution/RunLifecycle.js";
import {
  isExecutionCancellationReason,
  type ExecutionCancellationReason,
} from "../../../runtime/execution/ExecutionCancellationReason.js";
import { OutputPayload } from "../OutputPayload.js";

interface AgentRunStateChangedPayloadBaseOptions {
  inputEvent: DurableInputEventReference;
  previous: RunStatus | null;
  reason: RunStateChangeReason;
}

export type AgentRunStateChangedPayloadOptions = AgentRunStateChangedPayloadBaseOptions &
  (
    | {
        current: "cancelled";
        cancellationReason: ExecutionCancellationReason;
      }
    | {
        current: Exclude<RunStatus, "cancelled">;
        cancellationReason?: never;
      }
  );

export class AgentRunStateChangedPayload extends OutputPayload {
  readonly inputEvent: DurableInputEventReference;
  readonly previous: RunStatus | null;
  readonly current: RunStatus;
  readonly reason: RunStateChangeReason;
  readonly cancellationReason?: ExecutionCancellationReason;

  constructor(options: AgentRunStateChangedPayloadOptions) {
    super();
    if (options.previous !== null && !isRunStatus(options.previous)) {
      throw new TypeError("Previous Run status must be null or a registered status");
    }
    if (!isRunStatus(options.current)) {
      throw new TypeError("Current Run status must be registered");
    }
    if (!isRunStateChangeReason(options.reason)) {
      throw new TypeError("Run state change reason must be registered");
    }
    if (options.current === "cancelled") {
      if (!isExecutionCancellationReason(options.cancellationReason)) {
        throw new TypeError("Cancelled Run requires a registered cancellation reason");
      }
      this.cancellationReason = options.cancellationReason;
    } else if ("cancellationReason" in options && options.cancellationReason !== undefined) {
      throw new TypeError("Non-cancelled Run must not contain a cancellation reason");
    }

    this.inputEvent = captureDurableInputEventReference(options.inputEvent);
    this.previous = options.previous;
    this.current = options.current;
    this.reason = options.reason;
  }

  toObject(): JsonObject {
    return {
      inputEvent: { ...this.inputEvent },
      previous: this.previous,
      current: this.current,
      reason: this.reason,
      ...(this.cancellationReason !== undefined
        ? { cancellationReason: this.cancellationReason }
        : {}),
    };
  }
}
