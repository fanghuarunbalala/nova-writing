/** Serializable logical Runtime Presence transition without placement identity. */
import type {
  RuntimePresence,
  RuntimePresenceState,
} from "../../../conversation/RuntimePresence.js";
import type { JsonObject } from "../../protocol/JsonValue.js";
import { OutputPayload } from "../OutputPayload.js";

export const RUNTIME_PRESENCE_CHANGE_REASON = {
  acceptedInput: "accepted_input",
  explicitRestore: "explicit_restore",
  crashRecovery: "crash_recovery",
  activationSucceeded: "activation_succeeded",
  activationFailed: "activation_failed",
  explicitShutdown: "explicit_shutdown",
  hostClose: "host_close",
  idleEviction: "idle_eviction",
  replacement: "replacement",
  runtimeStopped: "runtime_stopped",
  runtimeCrashed: "runtime_crashed",
  exitObserverFailed: "exit_observer_failed",
  shutdownFailed: "shutdown_failed",
} as const;

export type RuntimePresenceChangeReason =
  (typeof RUNTIME_PRESENCE_CHANGE_REASON)[keyof typeof RUNTIME_PRESENCE_CHANGE_REASON];

export interface RuntimePresenceChangedPayloadOptions {
  previous: RuntimePresence;
  current: RuntimePresence;
  reason: RuntimePresenceChangeReason;
}

export class RuntimePresenceChangedPayload extends OutputPayload {
  readonly previous: RuntimePresence;
  readonly current: RuntimePresence;

  constructor(options: RuntimePresenceChangedPayloadOptions) {
    super();
    this.previous = capturePresence(options.previous);
    this.current = capturePresence(options.current);
    this.reason = options.reason;
  }

  readonly reason: RuntimePresenceChangeReason;

  toObject(): JsonObject {
    return {
      previous: { ...this.previous },
      current: { ...this.current },
      reason: this.reason,
    };
  }
}

function capturePresence(presence: RuntimePresence): RuntimePresence {
  return Object.freeze({
    state: presence.state as RuntimePresenceState,
    observedAt: presence.observedAt,
  });
}
