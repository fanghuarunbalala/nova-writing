/** Redacted public Nudge lifecycle payloads for replay and UI consumers. */
import type { JsonObject } from "../../protocol/JsonValue.js";
import { OutputPayload } from "../OutputPayload.js";

export interface NudgePublicIdentityOptions {
  readonly nudgeId: string;
  readonly policyId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly targetTurnNumber?: number;
}

abstract class NudgeLifecyclePayload extends OutputPayload {
  readonly nudgeId: string;
  readonly policyId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly targetTurnNumber?: number;

  protected constructor(options: NudgePublicIdentityOptions) {
    super();
    this.nudgeId = requireNonBlank("Nudge ID", options.nudgeId);
    this.policyId = requireNonBlank("Policy ID", options.policyId);
    this.templateId = requireNonBlank("Template ID", options.templateId);
    this.templateVersion = requireNonBlank(
      "Template version",
      options.templateVersion,
    );
    this.targetTurnNumber = captureOptionalPositiveInteger(
      "Target Turn number",
      options.targetTurnNumber,
    );
  }

  protected identityObject(): JsonObject {
    return {
      nudgeId: this.nudgeId,
      policyId: this.policyId,
      templateId: this.templateId,
      templateVersion: this.templateVersion,
      ...(this.targetTurnNumber === undefined
        ? {}
        : { targetTurnNumber: this.targetTurnNumber }),
    };
  }
}

export class NudgeScheduledPayload extends NudgeLifecyclePayload {
  readonly state = "scheduled" as const;

  constructor(options: NudgePublicIdentityOptions) {
    super(options);
  }

  toObject(): JsonObject {
    return {
      ...this.identityObject(),
      state: this.state,
    };
  }
}

export interface SystemReminderInjectedPayloadOptions
  extends NudgePublicIdentityOptions {
  readonly leaseId: string;
  readonly providerCallId: string;
}

export class SystemReminderInjectedPayload extends NudgeLifecyclePayload {
  readonly leaseId: string;
  readonly providerCallId: string;
  readonly state = "consumed" as const;

  constructor(options: SystemReminderInjectedPayloadOptions) {
    super(options);
    this.leaseId = requireNonBlank("Nudge Lease ID", options.leaseId);
    this.providerCallId = requireNonBlank(
      "Provider Call ID",
      options.providerCallId,
    );
  }

  toObject(): JsonObject {
    return {
      ...this.identityObject(),
      leaseId: this.leaseId,
      providerCallId: this.providerCallId,
      state: this.state,
    };
  }
}

export class NudgeExpiredPayload extends NudgeLifecyclePayload {
  readonly state = "expired" as const;

  constructor(options: NudgePublicIdentityOptions) {
    super(options);
  }

  toObject(): JsonObject {
    return {
      ...this.identityObject(),
      state: this.state,
    };
  }
}

function requireNonBlank(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
  return value;
}

function captureOptionalPositiveInteger(
  label: string,
  value: unknown,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value as number;
}
