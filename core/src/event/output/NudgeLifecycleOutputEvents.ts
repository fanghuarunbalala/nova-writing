/** Public redacted OutputEvents for scheduled, delivered, and expired Nudges. */
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import { SystemOutputEvent } from "./SystemOutputEvent.js";
import {
  NudgeExpiredPayload,
  NudgeScheduledPayload,
  SystemReminderInjectedPayload,
  type NudgePublicIdentityOptions,
  type SystemReminderInjectedPayloadOptions,
} from "./payload/NudgeLifecyclePayloads.js";

type NudgeLifecycleOutputEventOptions = Omit<OutputEventOptions, "runId"> &
  NudgePublicIdentityOptions & {
    readonly runId: string;
  };

export type NudgeScheduledOutputEventOptions = NudgeLifecycleOutputEventOptions;

export class NudgeScheduledOutputEvent extends SystemOutputEvent {
  constructor(options: NudgeScheduledOutputEventOptions) {
    const { runId, ...eventOptions } = options;
    assertNonBlank("Run ID", runId);
    super("nudge.scheduled", new NudgeScheduledPayload(options), {
      ...eventOptions,
      runId,
    });
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.nudgeScheduled;
  }
}

export type SystemReminderInjectedOutputEventOptions = Omit<
  OutputEventOptions,
  "runId"
> &
  SystemReminderInjectedPayloadOptions & {
    readonly runId: string;
  };

export class SystemReminderInjectedOutputEvent extends SystemOutputEvent {
  constructor(options: SystemReminderInjectedOutputEventOptions) {
    const { runId, ...eventOptions } = options;
    assertNonBlank("Run ID", runId);
    super(
      "reminder.injected",
      new SystemReminderInjectedPayload(options),
      {
        ...eventOptions,
        runId,
      },
    );
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.systemReminderInjected;
  }
}

export type NudgeExpiredOutputEventOptions = NudgeLifecycleOutputEventOptions;

export class NudgeExpiredOutputEvent extends SystemOutputEvent {
  constructor(options: NudgeExpiredOutputEventOptions) {
    const { runId, ...eventOptions } = options;
    assertNonBlank("Run ID", runId);
    super("nudge.expired", new NudgeExpiredPayload(options), {
      ...eventOptions,
      runId,
    });
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.nudgeExpired;
  }
}

function assertNonBlank(label: string, value: unknown): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}
