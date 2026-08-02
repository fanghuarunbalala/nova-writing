/** Redacted public payloads for the Tool approval interaction lifecycle. */
import type { JsonObject } from "../../protocol/JsonValue.js";
import { OutputPayload } from "../OutputPayload.js";

export interface ToolApprovalSummary {
  readonly title: string;
  readonly description?: string;
}

export interface ToolApprovalPublicIdentityOptions {
  readonly approvalRequestId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly argumentDigest: `sha256:${string}`;
}

export interface ToolApprovalRequestedPayloadOptions
  extends ToolApprovalPublicIdentityOptions {
  readonly summary: ToolApprovalSummary;
  readonly requestedAt: string;
  readonly expiresAt: string;
}

export type ToolApprovalResolutionDecision =
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

export interface ToolApprovalResolvedPayloadOptions
  extends ToolApprovalPublicIdentityOptions {
  readonly decision: ToolApprovalResolutionDecision;
  readonly actorId?: string;
  readonly resolvedAt: string;
}

abstract class ToolApprovalLifecyclePayload extends OutputPayload {
  readonly approvalRequestId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly argumentDigest: `sha256:${string}`;

  protected constructor(options: ToolApprovalPublicIdentityOptions) {
    super();
    this.approvalRequestId = requireIdentity(options.approvalRequestId);
    this.toolCallId = requireIdentity(options.toolCallId);
    this.toolName = requireToolName(options.toolName);
    this.toolVersion = requireToolVersion(options.toolVersion);
    this.argumentDigest = requireDigest(options.argumentDigest);
  }

  protected identityObject(): JsonObject {
    return {
      approvalRequestId: this.approvalRequestId,
      toolCallId: this.toolCallId,
      toolName: this.toolName,
      toolVersion: this.toolVersion,
      argumentDigest: this.argumentDigest,
    };
  }
}

export class ToolApprovalRequestedPayload extends ToolApprovalLifecyclePayload {
  readonly summary: ToolApprovalSummary;
  readonly requestedAt: string;
  readonly expiresAt: string;

  constructor(options: ToolApprovalRequestedPayloadOptions) {
    super(options);
    this.summary = captureSummary(options.summary);
    this.requestedAt = requireTimestamp(options.requestedAt);
    this.expiresAt = requireTimestamp(options.expiresAt);
    if (this.expiresAt <= this.requestedAt) {
      throw new TypeError("Approval expiry must be after request time");
    }
  }

  toObject(): JsonObject {
    return {
      ...this.identityObject(),
      summary: { ...this.summary },
      requestedAt: this.requestedAt,
      expiresAt: this.expiresAt,
    };
  }
}

export class ToolApprovalResolvedPayload extends ToolApprovalLifecyclePayload {
  readonly decision: ToolApprovalResolutionDecision;
  readonly actorId?: string;
  readonly resolvedAt: string;

  constructor(options: ToolApprovalResolvedPayloadOptions) {
    super(options);
    this.decision = requireResolution(options.decision);
    this.actorId = options.actorId === undefined
      ? undefined
      : requireIdentity(options.actorId);
    if (
      (this.decision === "approved" || this.decision === "rejected") !==
      (this.actorId !== undefined)
    ) {
      throw new TypeError("Approval actor identity does not match resolution kind");
    }
    this.resolvedAt = requireTimestamp(options.resolvedAt);
  }

  toObject(): JsonObject {
    return {
      ...this.identityObject(),
      decision: this.decision,
      ...(this.actorId === undefined ? {} : { actorId: this.actorId }),
      resolvedAt: this.resolvedAt,
    };
  }
}

function captureSummary(value: ToolApprovalSummary): ToolApprovalSummary {
  if (!value || typeof value !== "object") {
    throw new TypeError("Approval summary is invalid");
  }
  const title = requireBoundedText("Approval summary title", value.title, 256);
  const description = value.description === undefined
    ? undefined
    : requireBoundedText("Approval summary description", value.description, 1024);
  return Object.freeze({
    title,
    ...(description === undefined ? {} : { description }),
  });
}

function requireBoundedText(label: string, value: unknown, maximumBytes: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).byteLength > maximumBytes
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireIdentity(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  ) {
    throw new TypeError("Approval identity is invalid");
  }
  return value;
}

function requireToolName(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) {
    throw new TypeError("Approval Tool name is invalid");
  }
  return value;
}

function requireToolVersion(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  ) {
    throw new TypeError("Approval Tool version is invalid");
  }
  return value;
}

function requireDigest(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new TypeError("Approval argument digest is invalid");
  }
  return value as `sha256:${string}`;
}

function requireTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError("Approval timestamp is invalid");
  }
  return value;
}

function requireResolution(value: unknown): ToolApprovalResolutionDecision {
  if (
    value !== "approved" &&
    value !== "rejected" &&
    value !== "cancelled" &&
    value !== "expired"
  ) {
    throw new TypeError("Approval resolution is invalid");
  }
  return value;
}
