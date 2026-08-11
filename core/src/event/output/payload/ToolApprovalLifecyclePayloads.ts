/** Public payloads for the Tool approval interaction lifecycle. */
import type { JsonObject, JsonValue } from "../../protocol/JsonValue.js";
import { OutputPayload } from "../OutputPayload.js";

/**
 * 审批操作行（每目标一行，供前端审批卡渲染；不含完整内容）。
 * One human-facing operation row per approval target (op + kind + identifier).
 */
export interface ToolApprovalOperationSummary {
  readonly op: "add" | "edit" | "delete";
  /** Provider-neutral 实体类型键（如 outline/character/paragraph）。Entity-kind key. */
  readonly kind: string;
  readonly id?: string;
  readonly title?: string;
}

/** 审批摘要：标题、描述、结构化操作行，以及完整工具参数（可选）。Approval summary. */
export interface ToolApprovalSummary {
  readonly title: string;
  readonly description?: string;
  /** 完整工具参数，随审批事件自动携带（超限时由工厂降级省略）。Full tool arguments. */
  readonly arguments?: JsonValue;
  /** 每目标一行的操作摘要（列表渲染用）。Per-target operation rows. */
  readonly operations?: readonly ToolApprovalOperationSummary[];
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
  /** 所属 child runtime 实例（进程死亡/重启时用于判定审批失效）。Owning runtime instance. */
  readonly runtimeInstanceId: string;
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
  readonly runtimeInstanceId: string;
  readonly summary: ToolApprovalSummary;
  readonly requestedAt: string;
  readonly expiresAt: string;

  constructor(options: ToolApprovalRequestedPayloadOptions) {
    super(options);
    this.runtimeInstanceId = requireRuntimeInstanceId(options.runtimeInstanceId);
    this.summary = captureSummary(options.summary);
    this.requestedAt = requireTimestamp(options.requestedAt);
    this.expiresAt = requireTimestamp(options.expiresAt);
    if (this.expiresAt <= this.requestedAt) {
      throw new TypeError("Approval expiry must be after request time");
    }
  }

  toObject(): JsonObject {
    const summary: Record<string, JsonValue> = {
      title: this.summary.title,
    };
    if (this.summary.description !== undefined) {
      summary.description = this.summary.description;
    }
    if (this.summary.arguments !== undefined) {
      summary.arguments = this.summary.arguments;
    }
    if (this.summary.operations !== undefined) {
      summary.operations = this.summary.operations.map((operation) => {
        const row: Record<string, JsonValue> = {
          op: operation.op,
          kind: operation.kind,
        };
        if (operation.id !== undefined) row.id = operation.id;
        if (operation.title !== undefined) row.title = operation.title;
        return row;
      });
    }
    return {
      ...this.identityObject(),
      runtimeInstanceId: this.runtimeInstanceId,
      summary,
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
  const arguments_ = value.arguments === undefined
    ? undefined
    : requireBoundedJson("Approval summary arguments", value.arguments);
  const operations = value.operations === undefined
    ? undefined
    : requireOperations(value.operations);
  return Object.freeze({
    title,
    ...(description === undefined ? {} : { description }),
    ...(arguments_ === undefined ? {} : { arguments: arguments_ }),
    ...(operations === undefined ? {} : { operations }),
  });
}

const MAX_APPROVAL_ARGUMENTS_BYTES = 256 * 1024;
const MAX_APPROVAL_OPERATIONS = 64;

function requireBoundedJson(
  label: string,
  value: JsonValue,
): JsonValue {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(`${label} is not serializable`);
  }
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > MAX_APPROVAL_ARGUMENTS_BYTES
  ) {
    throw new TypeError(`${label} exceeds the size limit`);
  }
  return value;
}

function requireOperations(
  value: readonly ToolApprovalOperationSummary[],
): readonly ToolApprovalOperationSummary[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_APPROVAL_OPERATIONS
  ) {
    throw new TypeError("Approval summary operations are invalid");
  }
  return Object.freeze(
    value.map((item) => {
      if (!item || typeof item !== "object") {
        throw new TypeError("Approval summary operation is invalid");
      }
      const op = requireApprovalOperation(item.op);
      const kind = requireBoundedText("Approval operation kind", item.kind, 64);
      const id = item.id === undefined
        ? undefined
        : requireBoundedText("Approval operation id", item.id, 256);
      const title = item.title === undefined
        ? undefined
        : requireBoundedText("Approval operation title", item.title, 500);
      return Object.freeze({
        op,
        kind,
        ...(id === undefined ? {} : { id }),
        ...(title === undefined ? {} : { title }),
      });
    }),
  );
}

function requireApprovalOperation(
  value: ToolApprovalOperationSummary["op"],
): ToolApprovalOperationSummary["op"] {
  if (value !== "add" && value !== "edit" && value !== "delete") {
    throw new TypeError("Approval operation op is invalid");
  }
  return value;
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

function requireRuntimeInstanceId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Approval runtime instance id is invalid");
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
  if (typeof value !== "string" || !/^[A-Z][A-Za-z0-9]{0,63}$/.test(value)) {
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
