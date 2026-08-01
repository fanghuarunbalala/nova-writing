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
import { OutputPayload } from "../OutputPayload.js";

export interface AgentRunStateChangedPayloadOptions {
  inputEvent: DurableInputEventReference;
  previous: RunStatus | null;
  current: RunStatus;
  reason: RunStateChangeReason;
}

export class AgentRunStateChangedPayload extends OutputPayload {
  readonly inputEvent: DurableInputEventReference;
  readonly previous: RunStatus | null;
  readonly current: RunStatus;
  readonly reason: RunStateChangeReason;

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
    };
  }
}
