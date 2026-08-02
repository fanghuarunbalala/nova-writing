/** Strictly captures immutable Runtime IPC frames before transport ownership. */
import {
  canonicalStringifyJson,
  type JsonValue,
} from "../../../event/protocol/index.js";
import {
  RUNTIME_IPC_ERROR_CATEGORY,
  type RuntimeIpcErrorCategory,
  type RuntimeIpcErrorSnapshot,
} from "./RuntimeIpcErrorSnapshot.js";
import {
  RUNTIME_IPC_FRAME_TYPE,
  RUNTIME_IPC_MAX_FRAME_BYTES,
  RUNTIME_IPC_PROTOCOL_FAMILY,
  RUNTIME_IPC_PROTOCOL_VERSION,
  RUNTIME_IPC_REJECTION_REASON,
  type RuntimeIpcFrame,
  type RuntimeIpcFrameType,
  type RuntimeIpcHelloFrame,
  type RuntimeIpcNotificationFrame,
  type RuntimeIpcProtocolRange,
  type RuntimeIpcRejectedFrame,
  type RuntimeIpcRequestFrame,
  type RuntimeIpcResponseFrame,
  type RuntimeIpcWelcomeFrame,
} from "./RuntimeIpcProtocol.js";
import {
  RUNTIME_IPC_PROTOCOL_FAILURE,
  RuntimeIpcProtocolError,
  type RuntimeIpcProtocolErrorIdentity,
  type RuntimeIpcProtocolFailure,
} from "./RuntimeIpcProtocolErrors.js";

const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const IPC_METHOD = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const textEncoder = new TextEncoder();

const FRAME_FIELDS = Object.freeze({
  hello: new Set(["frameType", "protocolFamily", "supportedProtocol", "processNonce"]),
  welcome: new Set(["frameType", "protocolVersion", "sessionId", "processNonce"]),
  rejected: new Set([
    "frameType",
    "protocolFamily",
    "reason",
    "supportedProtocol",
    "processNonce",
  ]),
  request: new Set([
    "frameType",
    "protocolVersion",
    "sessionId",
    "requestId",
    "method",
    "payload",
  ]),
  responseSuccess: new Set([
    "frameType",
    "protocolVersion",
    "sessionId",
    "requestId",
    "ok",
    "data",
  ]),
  responseFailure: new Set([
    "frameType",
    "protocolVersion",
    "sessionId",
    "requestId",
    "ok",
    "error",
  ]),
  notification: new Set([
    "frameType",
    "protocolVersion",
    "sessionId",
    "notificationId",
    "method",
    "payload",
  ]),
});

export function captureRuntimeIpcFrame(value: unknown): RuntimeIpcFrame {
  const record = capturePlainRecord(value);
  const identity = frameIdentity(record);
  try {
    if (!record) throw new Error();
    let frame: RuntimeIpcFrame;
    switch (record.frameType) {
      case RUNTIME_IPC_FRAME_TYPE.hello:
        frame = captureHelloFrame(record);
        break;
      case RUNTIME_IPC_FRAME_TYPE.welcome:
        frame = captureWelcomeFrame(record);
        break;
      case RUNTIME_IPC_FRAME_TYPE.rejected:
        frame = captureRejectedFrame(record);
        break;
      case RUNTIME_IPC_FRAME_TYPE.request:
        frame = captureRequestFrame(record);
        break;
      case RUNTIME_IPC_FRAME_TYPE.response:
        frame = captureResponseFrame(record);
        break;
      case RUNTIME_IPC_FRAME_TYPE.notification:
        frame = captureNotificationFrame(record);
        break;
      default:
        throw new Error();
    }
    assertFrameSize(frame, identity);
    return frame;
  } catch (error) {
    if (error instanceof RuntimeIpcProtocolError) throw error;
    throw failure(RUNTIME_IPC_PROTOCOL_FAILURE.invalidFrame, identity);
  }
}

export function captureRuntimeIpcProtocolRange(
  value: unknown,
): RuntimeIpcProtocolRange {
  const record = capturePlainRecord(value);
  try {
    if (!record) throw new Error();
    assertExactFields(record, new Set(["minimumVersion", "maximumVersion"]));
    const minimumVersion = requireProtocolNumber(record.minimumVersion);
    const maximumVersion = requireProtocolNumber(record.maximumVersion);
    if (minimumVersion > maximumVersion) throw new Error();
    return Object.freeze({ minimumVersion, maximumVersion });
  } catch (error) {
    if (error instanceof RuntimeIpcProtocolError) throw error;
    throw failure(RUNTIME_IPC_PROTOCOL_FAILURE.invalidProtocolRange);
  }
}

export function negotiateRuntimeIpcProtocolVersion(
  localSource: RuntimeIpcProtocolRange,
  remoteSource: RuntimeIpcProtocolRange,
): number {
  const local = captureRuntimeIpcProtocolRange(localSource);
  const remote = captureRuntimeIpcProtocolRange(remoteSource);
  const minimumCompatible = Math.max(
    local.minimumVersion,
    remote.minimumVersion,
  );
  const selected = Math.min(local.maximumVersion, remote.maximumVersion);
  if (selected < minimumCompatible) {
    throw failure(RUNTIME_IPC_PROTOCOL_FAILURE.unsupportedProtocolVersion);
  }
  return selected;
}

export function captureRuntimeIpcErrorSnapshot(
  value: unknown,
): RuntimeIpcErrorSnapshot {
  const record = capturePlainRecord(value);
  try {
    if (!record) throw new Error();
    assertExactFields(record, new Set(["code", "category", "retryable"]));
    return Object.freeze({
      code: requireErrorCode(record.code),
      category: requireErrorCategory(record.category),
      retryable: requireBoolean(record.retryable),
    });
  } catch (error) {
    if (error instanceof RuntimeIpcProtocolError) throw error;
    throw failure(RUNTIME_IPC_PROTOCOL_FAILURE.invalidErrorSnapshot);
  }
}

export function sameRuntimeIpcRequest(
  leftSource: RuntimeIpcRequestFrame,
  rightSource: RuntimeIpcRequestFrame,
): boolean {
  const left = captureRuntimeIpcFrame(leftSource);
  const right = captureRuntimeIpcFrame(rightSource);
  if (left.frameType !== "request" || right.frameType !== "request") return false;
  return canonicalStringifyJson(requestComparisonValue(left)) ===
    canonicalStringifyJson(requestComparisonValue(right));
}

function captureHelloFrame(
  record: Record<string, unknown>,
): RuntimeIpcHelloFrame {
  assertExactFields(record, FRAME_FIELDS.hello);
  if (record.protocolFamily !== RUNTIME_IPC_PROTOCOL_FAMILY) throw new Error();
  return Object.freeze({
    frameType: RUNTIME_IPC_FRAME_TYPE.hello,
    protocolFamily: RUNTIME_IPC_PROTOCOL_FAMILY,
    supportedProtocol: captureRuntimeIpcProtocolRange(record.supportedProtocol),
    processNonce: requireIdentity(record.processNonce),
  });
}

function captureWelcomeFrame(
  record: Record<string, unknown>,
): RuntimeIpcWelcomeFrame {
  assertExactFields(record, FRAME_FIELDS.welcome);
  return Object.freeze({
    frameType: RUNTIME_IPC_FRAME_TYPE.welcome,
    protocolVersion: requireCurrentProtocolVersion(record.protocolVersion),
    sessionId: requireIdentity(record.sessionId),
    processNonce: requireIdentity(record.processNonce),
  });
}

function captureRejectedFrame(
  record: Record<string, unknown>,
): RuntimeIpcRejectedFrame {
  assertExactFields(record, FRAME_FIELDS.rejected);
  if (
    record.protocolFamily !== RUNTIME_IPC_PROTOCOL_FAMILY ||
    record.reason !== RUNTIME_IPC_REJECTION_REASON.unsupportedVersion
  ) {
    throw new Error();
  }
  return Object.freeze({
    frameType: RUNTIME_IPC_FRAME_TYPE.rejected,
    protocolFamily: RUNTIME_IPC_PROTOCOL_FAMILY,
    reason: RUNTIME_IPC_REJECTION_REASON.unsupportedVersion,
    supportedProtocol: captureRuntimeIpcProtocolRange(record.supportedProtocol),
    processNonce: requireIdentity(record.processNonce),
  });
}

function captureRequestFrame(
  record: Record<string, unknown>,
): RuntimeIpcRequestFrame {
  assertExactFields(record, FRAME_FIELDS.request);
  return Object.freeze({
    frameType: RUNTIME_IPC_FRAME_TYPE.request,
    protocolVersion: requireCurrentProtocolVersion(record.protocolVersion),
    sessionId: requireIdentity(record.sessionId),
    requestId: requireIdentity(record.requestId),
    method: requireMethod(record.method),
    payload: captureJsonValue(record.payload),
  });
}

function captureResponseFrame(
  record: Record<string, unknown>,
): RuntimeIpcResponseFrame {
  if (record.ok === true) {
    assertExactFields(record, FRAME_FIELDS.responseSuccess);
    return Object.freeze({
      frameType: RUNTIME_IPC_FRAME_TYPE.response,
      protocolVersion: requireCurrentProtocolVersion(record.protocolVersion),
      sessionId: requireIdentity(record.sessionId),
      requestId: requireIdentity(record.requestId),
      ok: true,
      data: captureJsonValue(record.data),
    });
  }
  if (record.ok === false) {
    assertExactFields(record, FRAME_FIELDS.responseFailure);
    return Object.freeze({
      frameType: RUNTIME_IPC_FRAME_TYPE.response,
      protocolVersion: requireCurrentProtocolVersion(record.protocolVersion),
      sessionId: requireIdentity(record.sessionId),
      requestId: requireIdentity(record.requestId),
      ok: false,
      error: captureRuntimeIpcErrorSnapshot(record.error),
    });
  }
  throw new Error();
}

function captureNotificationFrame(
  record: Record<string, unknown>,
): RuntimeIpcNotificationFrame {
  assertExactFields(record, FRAME_FIELDS.notification);
  return Object.freeze({
    frameType: RUNTIME_IPC_FRAME_TYPE.notification,
    protocolVersion: requireCurrentProtocolVersion(record.protocolVersion),
    sessionId: requireIdentity(record.sessionId),
    notificationId: requireIdentity(record.notificationId),
    method: requireMethod(record.method),
    payload: captureJsonValue(record.payload),
  });
}

function captureJsonValue(value: unknown): JsonValue {
  return captureJson(value, new Set<object>());
}

function captureJson(value: unknown, seen: Set<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error();
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) throw new Error();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0) throw new Error();
      const captured: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new Error();
        }
        captured.push(captureJson(descriptor.value, seen));
      }
      const allowedKeys = new Set([
        "length",
        ...Array.from({ length: value.length }, (_entry, index) => String(index)),
      ]);
      if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowedKeys.has(key))) {
        throw new Error();
      }
      return Object.freeze(captured) as unknown as JsonValue;
    }

    const record = capturePlainRecord(value);
    if (!record) throw new Error();
    return Object.freeze(
      Object.fromEntries(
        Object.entries(record).map(([key, entry]) => [
          key,
          captureJson(entry, seen),
        ]),
      ),
    );
  } finally {
    seen.delete(value);
  }
}

function capturePlainRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (Object.getOwnPropertySymbols(value).length > 0) return undefined;

    const captured: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (!descriptor.enumerable || !("value" in descriptor)) return undefined;
      captured[key] = descriptor.value;
    }
    return captured;
  } catch {
    return undefined;
  }
}

function assertExactFields(
  record: Record<string, unknown>,
  fields: ReadonlySet<string>,
): void {
  const keys = Object.keys(record);
  if (keys.length !== fields.size || keys.some((key) => !fields.has(key))) {
    throw new Error();
  }
}

function assertFrameSize(
  frame: RuntimeIpcFrame,
  identity: RuntimeIpcProtocolErrorIdentity,
): void {
  if (textEncoder.encode(JSON.stringify(frame)).byteLength > RUNTIME_IPC_MAX_FRAME_BYTES) {
    throw failure(RUNTIME_IPC_PROTOCOL_FAILURE.frameOversized, identity);
  }
}

function requireCurrentProtocolVersion(value: unknown) {
  if (value !== RUNTIME_IPC_PROTOCOL_VERSION) throw new Error();
  return RUNTIME_IPC_PROTOCOL_VERSION;
}

function requestComparisonValue(request: RuntimeIpcRequestFrame): JsonValue {
  return {
    frameType: request.frameType,
    protocolVersion: request.protocolVersion,
    sessionId: request.sessionId,
    requestId: request.requestId,
    method: request.method,
    payload: request.payload,
  };
}

function requireProtocolNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new Error();
  }
  return value as number;
}

function requireIdentity(value: unknown): string {
  if (typeof value !== "string" || !SAFE_IDENTITY.test(value)) throw new Error();
  return value;
}

function requireMethod(value: unknown): string {
  if (typeof value !== "string" || !IPC_METHOD.test(value) || value.length > 128) {
    throw new Error();
  }
  return value;
}

function requireErrorCode(value: unknown): string {
  if (typeof value !== "string" || !SAFE_ERROR_CODE.test(value)) throw new Error();
  return value;
}

function requireErrorCategory(value: unknown): RuntimeIpcErrorCategory {
  if (
    typeof value !== "string" ||
    !Object.values(RUNTIME_IPC_ERROR_CATEGORY).some((category) => category === value)
  ) {
    throw new Error();
  }
  return value as RuntimeIpcErrorCategory;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error();
  return value;
}

function frameIdentity(
  record: Record<string, unknown> | undefined,
): RuntimeIpcProtocolErrorIdentity {
  return Object.freeze({
    ...(isFrameType(record?.frameType) ? { frameType: record.frameType } : {}),
    ...(safeIdentity(record?.requestId) === undefined
      ? {}
      : { requestId: safeIdentity(record?.requestId) }),
    ...(safeIdentity(record?.notificationId) === undefined
      ? {}
      : { notificationId: safeIdentity(record?.notificationId) }),
    ...(safeMethod(record?.method) === undefined
      ? {}
      : { method: safeMethod(record?.method) }),
  });
}

function isFrameType(value: unknown): value is RuntimeIpcFrameType {
  return typeof value === "string" &&
    Object.values(RUNTIME_IPC_FRAME_TYPE).some((frameType) => frameType === value);
}

function safeIdentity(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_IDENTITY.test(value) ? value : undefined;
}

function safeMethod(value: unknown): string | undefined {
  return typeof value === "string" && IPC_METHOD.test(value) && value.length <= 128
    ? value
    : undefined;
}

function failure(
  failureCode: RuntimeIpcProtocolFailure,
  identity: RuntimeIpcProtocolErrorIdentity = {},
): RuntimeIpcProtocolError {
  return new RuntimeIpcProtocolError(failureCode, identity);
}
