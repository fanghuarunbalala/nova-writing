/** Redacted parent-visible payloads for one child Conversation lifecycle. */
import type { JsonObject } from "../../protocol/JsonValue.js";
import {
  captureArtifactReference,
  type ArtifactReference,
} from "../../../storage/artifact/index.js";
import { OutputPayload } from "../OutputPayload.js";

const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const PROGRESS_CODE = /^[a-z][a-z0-9_.-]{0,127}$/;
const MAX_SUMMARY_BYTES = 4 * 1024;
const CANCELLATION_REASONS = Object.freeze([
  "parent_completed",
  "parent_failed",
  "parent_stopped",
  "parent_crashed",
  "explicit",
  "limit_reclaimed",
  "orphan_reclaimed",
] as const);
type SubagentProjectionCancellationReason = (typeof CANCELLATION_REASONS)[number];

export interface SubagentLifecycleIdentityOptions {
  readonly subagentId: string;
  readonly childConversationId: string;
}

export interface SubagentStartedPayloadOptions extends SubagentLifecycleIdentityOptions {
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly startedAt: string;
}

export interface SubagentProgressPayloadOptions extends SubagentLifecycleIdentityOptions {
  readonly progressCode: string;
  readonly ordinal: number;
  readonly reportedAt: string;
}

export interface SubagentCompletedPayloadOptions extends SubagentLifecycleIdentityOptions {
  readonly summary?: string;
  readonly artifactReferences: readonly ArtifactReference[];
  readonly completedAt: string;
}

export interface SubagentFailedPayloadOptions extends SubagentLifecycleIdentityOptions {
  readonly outcome: "failed" | "orphaned";
  readonly errorCode?: string;
  readonly cancellationReason?: SubagentProjectionCancellationReason;
  readonly artifactReferences: readonly ArtifactReference[];
  readonly failedAt: string;
}

export interface SubagentCancelledPayloadOptions extends SubagentLifecycleIdentityOptions {
  readonly cancellationReason: SubagentProjectionCancellationReason;
  readonly artifactReferences: readonly ArtifactReference[];
  readonly cancelledAt: string;
}

abstract class SubagentLifecyclePayload extends OutputPayload {
  readonly subagentId: string;
  readonly childConversationId: string;

  protected constructor(options: SubagentLifecycleIdentityOptions) {
    super();
    this.subagentId = requireIdentity(options.subagentId);
    this.childConversationId = requireIdentity(options.childConversationId);
  }

  protected identityObject(): JsonObject {
    return { subagentId: this.subagentId, childConversationId: this.childConversationId };
  }
}

export class SubagentStartedPayload extends SubagentLifecyclePayload {
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly startedAt: string;

  constructor(options: SubagentStartedPayloadOptions) {
    super(options);
    this.agentType = requireBoundedText(options.agentType, 128);
    this.definitionVersion = requireBoundedText(options.definitionVersion, 128);
    this.startedAt = requireTimestamp(options.startedAt);
  }

  toObject(): JsonObject {
    return { ...this.identityObject(), agentType: this.agentType, definitionVersion: this.definitionVersion, startedAt: this.startedAt };
  }
}

export class SubagentProgressPayload extends SubagentLifecyclePayload {
  readonly progressCode: string;
  readonly ordinal: number;
  readonly reportedAt: string;

  constructor(options: SubagentProgressPayloadOptions) {
    super(options);
    if (!PROGRESS_CODE.test(options.progressCode)) throw new TypeError("Subagent progress code is invalid");
    if (!Number.isSafeInteger(options.ordinal) || options.ordinal < 1) throw new TypeError("Subagent progress ordinal is invalid");
    this.progressCode = options.progressCode;
    this.ordinal = options.ordinal;
    this.reportedAt = requireTimestamp(options.reportedAt);
  }

  toObject(): JsonObject {
    return { ...this.identityObject(), progressCode: this.progressCode, ordinal: this.ordinal, reportedAt: this.reportedAt };
  }
}

export class SubagentCompletedPayload extends SubagentLifecyclePayload {
  readonly summary?: string;
  readonly artifactReferences: readonly ArtifactReference[];
  readonly completedAt: string;

  constructor(options: SubagentCompletedPayloadOptions) {
    super(options);
    this.summary = options.summary === undefined ? undefined : requireBoundedText(options.summary, MAX_SUMMARY_BYTES);
    this.artifactReferences = captureArtifacts(options.artifactReferences, this.childConversationId);
    if (this.summary === undefined && this.artifactReferences.length === 0) throw new TypeError("Completed Subagent projection requires a result");
    this.completedAt = requireTimestamp(options.completedAt);
  }

  toObject(): JsonObject {
    return { ...this.identityObject(), ...(this.summary === undefined ? {} : { summary: this.summary }), artifactReferences: this.artifactReferences.map(artifactToObject), completedAt: this.completedAt };
  }
}

export class SubagentFailedPayload extends SubagentLifecyclePayload {
  readonly outcome: "failed" | "orphaned";
  readonly errorCode?: string;
  readonly cancellationReason?: SubagentProjectionCancellationReason;
  readonly artifactReferences: readonly ArtifactReference[];
  readonly failedAt: string;

  constructor(options: SubagentFailedPayloadOptions) {
    super(options);
    if (options.outcome !== "failed" && options.outcome !== "orphaned") throw new TypeError("Subagent failure outcome is invalid");
    if ((options.outcome === "failed") !== (options.errorCode !== undefined)) throw new TypeError("Subagent failure code is inconsistent");
    if ((options.outcome === "orphaned") !== (options.cancellationReason !== undefined)) throw new TypeError("Subagent orphan reason is inconsistent");
    this.outcome = options.outcome;
    this.errorCode = options.errorCode === undefined ? undefined : requireSafeCode(options.errorCode);
    this.cancellationReason = options.cancellationReason === undefined ? undefined : requireCancellationReason(options.cancellationReason);
    this.artifactReferences = captureArtifacts(options.artifactReferences, this.childConversationId);
    this.failedAt = requireTimestamp(options.failedAt);
  }

  toObject(): JsonObject {
    return { ...this.identityObject(), outcome: this.outcome, ...(this.errorCode === undefined ? {} : { errorCode: this.errorCode }), ...(this.cancellationReason === undefined ? {} : { cancellationReason: this.cancellationReason }), artifactReferences: this.artifactReferences.map(artifactToObject), failedAt: this.failedAt };
  }
}

export class SubagentCancelledPayload extends SubagentLifecyclePayload {
  readonly cancellationReason: SubagentProjectionCancellationReason;
  readonly artifactReferences: readonly ArtifactReference[];
  readonly cancelledAt: string;

  constructor(options: SubagentCancelledPayloadOptions) {
    super(options);
    this.cancellationReason = requireCancellationReason(options.cancellationReason);
    this.artifactReferences = captureArtifacts(options.artifactReferences, this.childConversationId);
    this.cancelledAt = requireTimestamp(options.cancelledAt);
  }

  toObject(): JsonObject {
    return { ...this.identityObject(), cancellationReason: this.cancellationReason, artifactReferences: this.artifactReferences.map(artifactToObject), cancelledAt: this.cancelledAt };
  }
}

function captureArtifacts(values: readonly ArtifactReference[], childConversationId: string): readonly ArtifactReference[] {
  if (!Array.isArray(values)) throw new TypeError("Artifact references are invalid");
  for (let index = 0; index < values.length; index += 1) {
    if (!(index in values)) throw new TypeError("Artifact references are invalid");
  }
  return Object.freeze(values.map((value) => {
    const artifact = captureArtifactReference(value);
    if (artifact.conversationId !== childConversationId) throw new TypeError("Subagent Artifact ownership is invalid");
    return artifact;
  }));
}

function artifactToObject(artifact: ArtifactReference): JsonObject {
  return { schemaVersion: artifact.schemaVersion, artifactId: artifact.artifactId, conversationId: artifact.conversationId, contentType: artifact.contentType, byteLength: artifact.byteLength, digest: artifact.digest, ...(artifact.tokenEstimate === undefined ? {} : { tokenEstimate: artifact.tokenEstimate }), ...(artifact.filename === undefined ? {} : { filename: artifact.filename }) };
}

function requireIdentity(value: unknown): string { if (typeof value !== "string" || !IDENTITY.test(value)) throw new TypeError("Subagent identity is invalid"); return value; }
function requireBoundedText(value: unknown, maximumBytes: number): string { if (typeof value !== "string" || value.trim().length === 0 || new TextEncoder().encode(value).byteLength > maximumBytes) throw new TypeError("Subagent text is invalid"); return value; }
function requireSafeCode(value: unknown): string { if (typeof value !== "string" || !SAFE_CODE.test(value)) throw new TypeError("Subagent error code is invalid"); return value; }
function requireCancellationReason(value: unknown): SubagentProjectionCancellationReason { if (!CANCELLATION_REASONS.includes(value as never)) throw new TypeError("Subagent cancellation reason is invalid"); return value as SubagentProjectionCancellationReason; }
function requireTimestamp(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new TypeError("Subagent timestamp is invalid"); return value; }
