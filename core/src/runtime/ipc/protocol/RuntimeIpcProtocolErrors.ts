/** Stable local failures for malformed or incompatible Runtime IPC values. */
import type {
  RuntimeIpcErrorCategory,
  RuntimeIpcErrorSnapshot,
} from "./RuntimeIpcErrorSnapshot.js";
import type { RuntimeIpcFrameType } from "./RuntimeIpcProtocol.js";

export const RUNTIME_IPC_PROTOCOL_FAILURE = {
  invalidFrame: "invalid_frame",
  frameOversized: "frame_oversized",
  invalidProtocolRange: "invalid_protocol_range",
  unsupportedProtocolVersion: "unsupported_protocol_version",
  invalidErrorSnapshot: "invalid_error_snapshot",
} as const;

export type RuntimeIpcProtocolFailure =
  (typeof RUNTIME_IPC_PROTOCOL_FAILURE)[keyof typeof RUNTIME_IPC_PROTOCOL_FAILURE];

export interface RuntimeIpcProtocolErrorIdentity {
  readonly frameType?: RuntimeIpcFrameType;
  readonly requestId?: string;
  readonly notificationId?: string;
  readonly method?: string;
}

export class RuntimeIpcProtocolError extends Error {
  readonly code = "RUNTIME_IPC_PROTOCOL_ERROR";
  readonly failure: RuntimeIpcProtocolFailure;
  readonly identity: RuntimeIpcProtocolErrorIdentity;

  constructor(
    failure: RuntimeIpcProtocolFailure,
    identity: RuntimeIpcProtocolErrorIdentity = {},
  ) {
    super(`Runtime IPC protocol failure: ${failure}`);
    this.name = "RuntimeIpcProtocolError";
    this.failure = failure;
    this.identity = Object.freeze({ ...identity });
  }
}

export class RuntimeIpcRemoteError extends Error {
  readonly code: string;
  readonly category: RuntimeIpcErrorCategory;
  readonly retryable: boolean;

  constructor(snapshot: RuntimeIpcErrorSnapshot) {
    const captured = captureRemoteErrorSnapshot(snapshot);
    super(`Remote Runtime IPC request failed: ${captured.code}`);
    this.name = "RuntimeIpcRemoteError";
    this.code = captured.code;
    this.category = captured.category;
    this.retryable = captured.retryable;
  }
}

function captureRemoteErrorSnapshot(
  snapshot: RuntimeIpcErrorSnapshot,
): RuntimeIpcErrorSnapshot {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    typeof snapshot.code !== "string" ||
    !/^[A-Z][A-Z0-9_]{0,127}$/.test(snapshot.code) ||
    !isErrorCategory(snapshot.category) ||
    typeof snapshot.retryable !== "boolean"
  ) {
    throw new TypeError("Runtime IPC remote error snapshot is invalid");
  }
  return Object.freeze({
    code: snapshot.code,
    category: snapshot.category,
    retryable: snapshot.retryable,
  });
}

function isErrorCategory(value: unknown): value is RuntimeIpcErrorCategory {
  return (
    value === "validation" ||
    value === "protocol" ||
    value === "conflict" ||
    value === "cancelled" ||
    value === "unavailable" ||
    value === "internal"
  );
}
