/** Validates and freezes Nudge protocol values at Runtime boundaries. */
import {
  canonicalStringifyJson,
  isJsonValue,
  type JsonObject,
  type JsonValue,
} from "../../event/index.js";
import {
  NUDGE_DELIVERY,
  NUDGE_PLACEMENT,
  NUDGE_SELECTION_LIMIT,
  PENDING_NUDGE_STATE,
  type NudgeEffect,
  type NudgeAcknowledgementReference,
  type NudgeConditionReference,
  type NudgeDelivery,
  type NudgeLease,
  type NudgeLeaseRequest,
  type PendingNudge,
  type SystemReminderOverlay,
} from "./NudgeProtocol.js";
import {
  NUDGE_PROTOCOL_VALIDATION_FAILURE,
  NudgeProtocolValidationError,
  type NudgeProtocolValidationFailure,
} from "./NudgeProtocolErrors.js";

export function captureNudgeEffect(value: unknown): NudgeEffect {
  const record = requireRecord(value, NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidEffect);
  const targetRunId = requireNonBlank(
    record.targetRunId,
    NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidEffect,
  );

  try {
    if (record.kind !== "nudge") throw new Error();
    const delivery = captureDelivery(record.delivery, targetRunId);
    const acknowledgementRef = captureOptionalReference(
      record.acknowledgementRef,
      "acknowledgementRef",
      NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidAcknowledgementReference,
      targetRunId,
    );
    const conditionRef = captureOptionalReference(
      record.conditionRef,
      "conditionRef",
      NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidConditionReference,
      targetRunId,
    );
    assertDeliveryConfiguration(
      delivery,
      acknowledgementRef.acknowledgementRef,
      conditionRef.conditionRef,
      targetRunId,
    );
    const effect: NudgeEffect = {
      kind: "nudge",
      policyId: requireNonBlank(record.policyId),
      templateId: requireNonBlank(record.templateId),
      templateVersion: requireNonBlank(record.templateVersion),
      delivery,
      ...acknowledgementRef,
      ...conditionRef,
      priority: requireSafeInteger(record.priority),
      dedupeKey: requireNonBlank(record.dedupeKey),
      targetRunId,
      parameters: captureParameters(record.parameters),
      ...captureOptionalTurnNumber(record.targetTurnNumber, "targetTurnNumber"),
      ...captureOptionalNonNegativeInteger(record.cooldownTurns, "cooldownTurns"),
      ...captureOptionalTurnNumber(record.expiresAfterTurn, "expiresAfterTurn"),
      ...captureOptionalTimestamp(record.expiresAt, "expiresAt"),
      ...captureOptionalBoolean(record.exclusive, "exclusive"),
    };
    return deepFreeze(effect);
  } catch (error) {
    if (error instanceof NudgeProtocolValidationError) throw error;
    throw failure(
      NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidEffect,
      undefined,
      targetRunId,
    );
  }
}

export function capturePendingNudge(value: unknown): PendingNudge {
  const record = requireRecord(
    value,
    NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidPendingNudge,
  );
  const nudgeId = captureNonBlank(record.id);
  const targetRunId = captureNonBlank(record.targetRunId);

  try {
    if (!nudgeId || !targetRunId) throw new Error();
    if (!Object.values(PENDING_NUDGE_STATE).includes(record.state as never)) {
      throw new Error();
    }
    if (record.placement !== NUDGE_PLACEMENT.systemPromptOverlay) throw new Error();
    const delivery = captureDelivery(record.delivery, targetRunId);
    const acknowledgementRef = captureOptionalReference(
      record.acknowledgementRef,
      "acknowledgementRef",
      NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidAcknowledgementReference,
      targetRunId,
    );
    const conditionRef = captureOptionalReference(
      record.conditionRef,
      "conditionRef",
      NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidConditionReference,
      targetRunId,
    );
    assertDeliveryConfiguration(
      delivery,
      acknowledgementRef.acknowledgementRef,
      conditionRef.conditionRef,
      targetRunId,
    );

    const pending: PendingNudge = {
      id: nudgeId,
      policyId: requireNonBlank(record.policyId),
      templateId: requireNonBlank(record.templateId),
      templateVersion: requireNonBlank(record.templateVersion),
      priority: requireSafeInteger(record.priority),
      dedupeKey: requireNonBlank(record.dedupeKey),
      parameters: captureParameters(record.parameters),
      exclusive: requireBoolean(record.exclusive),
      placement: NUDGE_PLACEMENT.systemPromptOverlay,
      delivery,
      ...acknowledgementRef,
      ...conditionRef,
      state: record.state as PendingNudge["state"],
      targetRunId,
      scheduledSequence: requirePositiveInteger(record.scheduledSequence),
      scheduledAt: requireTimestamp(record.scheduledAt),
      ...captureOptionalTurnNumber(record.targetTurnNumber, "targetTurnNumber"),
      ...captureOptionalNonNegativeInteger(record.cooldownTurns, "cooldownTurns"),
      ...captureOptionalTurnNumber(record.expiresAfterTurn, "expiresAfterTurn"),
      ...captureOptionalTimestamp(record.expiresAt, "expiresAt"),
    };
    return deepFreeze(pending);
  } catch (error) {
    if (error instanceof NudgeProtocolValidationError) throw error;
    throw failure(
      NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidPendingNudge,
      nudgeId,
      targetRunId,
    );
  }
}

export function captureNudgeLeaseRequest(value: unknown): NudgeLeaseRequest {
  const record = requireRecord(
    value,
    NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidLeaseRequest,
  );
  const targetRunId = captureNonBlank(record.targetRunId);
  const providerCallId = captureNonBlank(record.providerCallId);

  try {
    if (!targetRunId || !providerCallId) throw new Error();
    const request: NudgeLeaseRequest = {
      providerCallId,
      targetRunId,
      requestedAt: requireTimestamp(record.requestedAt),
      ...captureOptionalTurnNumber(record.targetTurnNumber, "targetTurnNumber"),
      ...captureOptionalSelectionLimit(record.requestedLimit),
    };
    return Object.freeze(request);
  } catch {
    throw failure(
      NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidLeaseRequest,
      undefined,
      targetRunId,
      providerCallId,
    );
  }
}

export function resolveNudgeSelectionLimit(request: NudgeLeaseRequest): number {
  return request.requestedLimit ?? NUDGE_SELECTION_LIMIT.default;
}

export function captureNudgeLease(value: unknown): NudgeLease {
  const record = requireRecord(value, NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidLease);
  const targetRunId = captureNonBlank(record.targetRunId);
  const providerCallId = captureNonBlank(record.providerCallId);

  try {
    if (!targetRunId || !providerCallId) throw new Error();
    const lease: NudgeLease = {
      leaseId: requireNonBlank(record.leaseId),
      providerCallId,
      targetRunId,
      nudgeIds: captureNudgeIds(record.nudgeIds),
      leasedAt: requireTimestamp(record.leasedAt),
      ...captureOptionalTurnNumber(record.targetTurnNumber, "targetTurnNumber"),
    };
    return deepFreeze(lease);
  } catch {
    throw failure(
      NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidLease,
      undefined,
      targetRunId,
      providerCallId,
    );
  }
}

export function captureSystemReminderOverlay(value: unknown): SystemReminderOverlay {
  const record = requireRecord(value, NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidOverlay);

  try {
    if (record.placement !== NUDGE_PLACEMENT.systemPromptOverlay) throw new Error();
    const overlay: SystemReminderOverlay = {
      placement: NUDGE_PLACEMENT.systemPromptOverlay,
      nudgeIds: captureNudgeIds(record.nudgeIds),
      content: requireNonBlank(record.content),
    };
    return deepFreeze(overlay);
  } catch {
    throw failure(NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidOverlay);
  }
}

function captureParameters(value: unknown): Readonly<Record<string, JsonValue>> {
  if (!isPlainRecord(value) || !isJsonValue(value)) throw new Error();
  return deepFreeze(cloneJson(value) as JsonObject);
}

function captureNudgeIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error();
  if (value.length < 1 || value.length > NUDGE_SELECTION_LIMIT.maximum) {
    throw new Error();
  }
  const ids = value.map((item) => requireNonBlank(item));
  if (new Set(ids).size !== ids.length) throw new Error();
  return Object.freeze(ids);
}

function captureOptionalSelectionLimit(
  value: unknown,
): { readonly requestedLimit?: number } {
  if (value === undefined) return {};
  const limit = requirePositiveInteger(value);
  if (limit > NUDGE_SELECTION_LIMIT.maximum) throw new Error();
  return { requestedLimit: limit };
}

function captureOptionalTurnNumber(
  value: unknown,
  key: "targetTurnNumber" | "expiresAfterTurn",
): { readonly targetTurnNumber?: number; readonly expiresAfterTurn?: number } {
  if (value === undefined) return {};
  return { [key]: requirePositiveInteger(value) };
}

function captureOptionalNonNegativeInteger(
  value: unknown,
  key: "cooldownTurns",
): { readonly cooldownTurns?: number } {
  if (value === undefined) return {};
  return { [key]: requireNonNegativeInteger(value) };
}

function captureOptionalTimestamp(
  value: unknown,
  key: "expiresAt",
): { readonly expiresAt?: string } {
  if (value === undefined) return {};
  return { [key]: requireTimestamp(value) };
}

function captureOptionalBoolean(
  value: unknown,
  key: "exclusive",
): { readonly exclusive?: boolean } {
  if (value === undefined) return {};
  return { [key]: requireBoolean(value) };
}

function captureDelivery(
  value: unknown,
  targetRunId: string,
): NudgeDelivery {
  if (value === undefined) return NUDGE_DELIVERY.once;
  if (!Object.values(NUDGE_DELIVERY).includes(value as NudgeDelivery)) {
    throw failure(
      NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidDelivery,
      undefined,
      targetRunId,
    );
  }
  return value as NudgeDelivery;
}

function captureOptionalReference<T extends
  NudgeAcknowledgementReference | NudgeConditionReference>(
  value: unknown,
  key: "acknowledgementRef" | "conditionRef",
  invalid: NudgeProtocolValidationFailure,
  targetRunId: string,
): { readonly [K in typeof key]?: T } {
  if (value === undefined) return {};
  if (!isPlainRecord(value) || Object.keys(value).some(
    (field) => field !== "id" && field !== "version",
  )) {
    throw failure(invalid, undefined, targetRunId);
  }
  try {
    const reference = deepFreeze({
      id: requireNonBlank(value.id),
      version: requireNonBlank(value.version),
    }) as T;
    return { [key]: reference } as { readonly [K in typeof key]?: T };
  } catch {
    throw failure(invalid, undefined, targetRunId);
  }
}

function assertDeliveryConfiguration(
  delivery: NudgeDelivery,
  acknowledgementRef: NudgeAcknowledgementReference | undefined,
  conditionRef: NudgeConditionReference | undefined,
  targetRunId: string,
): void {
  const valid = delivery === NUDGE_DELIVERY.once
    ? acknowledgementRef === undefined && conditionRef === undefined
    : delivery === NUDGE_DELIVERY.untilAcknowledged
    ? acknowledgementRef !== undefined && conditionRef === undefined
    : conditionRef !== undefined && acknowledgementRef === undefined;
  if (!valid) {
    throw failure(
      NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidDeliveryConfiguration,
      undefined,
      targetRunId,
    );
  }
}

function requireRecord(
  value: unknown,
  invalid: NudgeProtocolValidationFailure,
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw failure(invalid);
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireNonBlank(
  value: unknown,
  invalid?: NudgeProtocolValidationFailure,
): string {
  const captured = captureNonBlank(value);
  if (!captured) {
    if (invalid) throw failure(invalid);
    throw new Error();
  }
  return captured;
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error();
  return value;
}

function requireSafeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error();
  return value;
}

function requirePositiveInteger(value: unknown): number {
  const captured = requireSafeInteger(value);
  if (captured < 1) throw new Error();
  return captured;
}

function requireNonNegativeInteger(value: unknown): number {
  const captured = requireSafeInteger(value);
  if (captured < 0) throw new Error();
  return captured;
}

function requireTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error();
  }
  return value;
}

function cloneJson(value: JsonValue): JsonValue {
  return JSON.parse(canonicalStringifyJson(value)) as JsonValue;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function failure(
  failureType: NudgeProtocolValidationFailure,
  nudgeId?: string,
  targetRunId?: string,
  providerCallId?: string,
): NudgeProtocolValidationError {
  return new NudgeProtocolValidationError(
    failureType,
    nudgeId,
    targetRunId,
    providerCallId,
  );
}
