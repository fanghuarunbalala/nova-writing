/**
 * Records one observable logical Runtime Presence transition.
 *
 * Runtime instance IDs, generations, PIDs, and transport identities are never
 * part of this public OutputEvent.
 */
import type { RuntimePresence } from "../../conversation/RuntimePresence.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import { SystemOutputEvent } from "./SystemOutputEvent.js";
import {
  RuntimePresenceChangedPayload,
  type RuntimePresenceChangeReason,
} from "./payload/RuntimePresenceChangedPayload.js";

export interface RuntimePresenceChangedOutputEventOptions
  extends OutputEventOptions {
  previous: RuntimePresence;
  current: RuntimePresence;
  reason: RuntimePresenceChangeReason;
}

export class RuntimePresenceChangedOutputEvent extends SystemOutputEvent {
  constructor(options: RuntimePresenceChangedOutputEventOptions) {
    const { previous, current, reason, ...eventOptions } = options;
    super(
      "runtime.presence.changed",
      new RuntimePresenceChangedPayload({ previous, current, reason }),
      {
        ...eventOptions,
        timestamp: eventOptions.timestamp ?? current.observedAt,
      },
    );
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.runtimePresenceChanged;
  }
}
