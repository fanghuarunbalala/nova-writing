import {
  ContextProtocolValidationError,
  type ContextProtocolValidationFailure,
} from "./ContextProtocolErrors.js";

export interface ContextValidationIdentity {
  readonly conversationId?: string;
  readonly runId?: string;
  readonly providerCallId?: string;
  readonly checkpointId?: string;
}

export function failure(
  failureType: ContextProtocolValidationFailure,
  identity: ContextValidationIdentity = {},
): ContextProtocolValidationError {
  return new ContextProtocolValidationError(
    failureType,
    identity.conversationId,
    identity.runId,
    identity.providerCallId,
    identity.checkpointId,
  );
}

export function captureIdentity(value: unknown): ContextValidationIdentity {
  const record = asPlainRecord(value);
  return Object.freeze({
    conversationId: captureNonBlank(record?.conversationId),
    runId: captureNonBlank(record?.runId),
    providerCallId: captureNonBlank(record?.providerCallId),
    checkpointId: captureNonBlank(record?.checkpointId ?? record?.id),
  });
}

export function requireRecord(
  value: unknown,
  failureType: ContextProtocolValidationFailure,
  identity: ContextValidationIdentity = {},
): Record<string, unknown> {
  const record = asPlainRecord(value);
  if (!record) throw failure(failureType, identity);
  return record;
}

export function asPlainRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function requireNonBlank(value: unknown): string {
  const captured = captureNonBlank(value);
  if (!captured) throw new Error();
  return captured;
}

export function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error();
  return value;
}

export function requireFiniteRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error();
  }
  return value;
}

export function requireNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error();
  }
  return value;
}

export function requirePositiveInteger(value: unknown): number {
  const captured = requireNonNegativeInteger(value);
  if (captured < 1) throw new Error();
  return captured;
}

export function requireTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error();
  }
  return value;
}

export function requireDigest(value: unknown): string {
  const digest = requireNonBlank(value);
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error();
  return digest;
}

export function requireUniqueNonBlankStrings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error();
  const captured = value.map(requireNonBlank);
  if (new Set(captured).size !== captured.length) throw new Error();
  return Object.freeze(captured);
}

export function requireNonEmptyUniqueNonBlankStrings(
  value: unknown,
): readonly string[] {
  const captured = requireUniqueNonBlankStrings(value);
  if (captured.length === 0) throw new Error();
  return captured;
}

export function numbersEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * Math.max(1, left, right) * 8;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
