/** Strict immutable codecs for the five-method Runtime persistence RPC allowlist. */
import {
  coreEventSchemaRegistry,
  isEventType,
  type JsonValue,
  type OutputEventSnapshot,
} from "../../../event/index.js";
import { captureContextCheckpoint } from "../../context/index.js";
import type { ToolApprovalInteractionSnapshot } from "../../interaction/index.js";
import { coreRuntimeMessageSchemaRegistry } from "../../message/index.js";
import { captureNudgeLease, capturePendingNudge } from "../../nudge/index.js";
import { captureToolApprovalIdentity } from "../../../tools/execution/index.js";
import {
  MESSAGE_PROJECTION_FORMAT_VERSION,
  validatePersistedConversationEventSnapshot,
  type ConversationEventPage,
  type ConversationEventQuery,
  type ConversationEventQueryAnchor,
  type ConversationMessageFilePage,
  type ConversationMessageFileQuery,
  type MessageProjectionMessageRecord,
} from "../../../storage/index.js";
import {
  RuntimePersistenceProtocolError,
} from "./RuntimePersistenceErrors.js";
import {
  RUNTIME_PERSISTENCE_RPC_METHOD,
  type RuntimeJournalAppendOutputReceipt,
  type RuntimeJournalAppendOutputRequest,
  type RuntimeJournalGetEventRequest,
  type RuntimeJournalGetEventResponse,
  type RuntimePersistenceRpcMethod,
  type RuntimeStateLoadRequest,
} from "./RuntimePersistenceProtocol.js";
import {
  RUNTIME_RECOVERY_SNAPSHOT_SCHEMA_VERSION,
  type RuntimeRecoverySnapshot,
} from "./RuntimeRecoverySnapshot.js";

const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_QUERY_LIMIT = 1_000;

export function isRuntimePersistenceRpcMethod(
  value: string,
): value is RuntimePersistenceRpcMethod {
  return Object.values(RUNTIME_PERSISTENCE_RPC_METHOD).includes(value as never);
}

export function captureRuntimeJournalGetEventRequest(
  value: unknown,
): RuntimeJournalGetEventRequest {
  return protocolCapture(RUNTIME_PERSISTENCE_RPC_METHOD.journalGetEvent, "invalid_request", () => {
    const record = exactRecord(value, ["conversationId", "sequence"]);
    return Object.freeze({
      conversationId: identity(record.conversationId),
      sequence: positiveInteger(record.sequence),
    });
  });
}

export function captureRuntimeJournalGetEventResponse(
  value: unknown,
  request: RuntimeJournalGetEventRequest,
): RuntimeJournalGetEventResponse {
  return protocolCapture(RUNTIME_PERSISTENCE_RPC_METHOD.journalGetEvent, "invalid_response", () => {
    const record = plainRecord(value);
    if (record.found === false) {
      assertExactKeys(record, ["found"]);
      return Object.freeze({ found: false });
    }
    assertExactKeys(record, ["found", "event"]);
    if (record.found !== true) throw new Error();
    const event = capturePersistedEvent(record.event, request.conversationId);
    if (event.sequence !== request.sequence) {
      throw new RuntimePersistenceProtocolError(
        "sequence_mismatch",
        RUNTIME_PERSISTENCE_RPC_METHOD.journalGetEvent,
      );
    }
    return Object.freeze({ found: true, event });
  });
}

export function captureRuntimeJournalListEventsRequest(
  value: unknown,
): ConversationEventQuery {
  return protocolCapture(RUNTIME_PERSISTENCE_RPC_METHOD.journalListEvents, "invalid_request", () => {
    const record = exactRecord(
      value,
      ["conversationId", "anchor"],
      ["throughSequence", "direction", "eventTypes", "runId", "turnId", "limit"],
    );
    return Object.freeze({
      conversationId: identity(record.conversationId),
      anchor: captureAnchor(record.anchor),
      ...(record.throughSequence === undefined
        ? {}
        : { throughSequence: nonNegativeInteger(record.throughSequence) }),
      ...(record.direction === undefined
        ? {}
        : { direction: eventDirection(record.direction) }),
      ...(record.eventTypes === undefined
        ? {}
        : { eventTypes: eventTypeList(record.eventTypes) }),
      ...(record.runId === undefined ? {} : { runId: identity(record.runId) }),
      ...(record.turnId === undefined ? {} : { turnId: identity(record.turnId) }),
      ...(record.limit === undefined ? {} : { limit: boundedLimit(record.limit) }),
    });
  });
}

export function captureRuntimeJournalListEventsResponse(
  value: unknown,
  request: ConversationEventQuery,
): ConversationEventPage {
  return protocolCapture(RUNTIME_PERSISTENCE_RPC_METHOD.journalListEvents, "invalid_response", () => {
    const record = exactRecord(
      captureJsonValue(value),
      ["events", "highWatermark", "hasPrevious", "hasNext"],
    );
    if (!Array.isArray(record.events)) throw new Error();
    const events = Object.freeze(
      record.events.map((event) => capturePersistedEvent(event, request.conversationId)),
    );
    const highWatermark = nonNegativeInteger(record.highWatermark);
    if (
      (request.throughSequence !== undefined && highWatermark > request.throughSequence) ||
      events.some((event) => event.sequence > highWatermark) ||
      events.some((event) => !matchesEventQuery(event, request)) ||
      events.length > (request.limit ?? MAX_QUERY_LIMIT)
    ) {
      throw new Error();
    }
    assertStrictAscending(events.map((event) => event.sequence));
    return Object.freeze({
      events: events as unknown as ConversationEventPage["events"],
      highWatermark,
      hasPrevious: booleanValue(record.hasPrevious),
      hasNext: booleanValue(record.hasNext),
    });
  });
}

export function captureRuntimeJournalAppendOutputRequest(
  value: unknown,
): RuntimeJournalAppendOutputRequest {
  return protocolCapture(RUNTIME_PERSISTENCE_RPC_METHOD.journalAppendOutput, "invalid_request", () => {
    const record = exactRecord(value, ["conversationId", "snapshot"]);
    const conversationId = identity(record.conversationId);
    return Object.freeze({
      conversationId,
      snapshot: captureOutputSnapshot(record.snapshot, conversationId),
    });
  });
}

export function captureRuntimeJournalAppendOutputReceipt(
  value: unknown,
  request: RuntimeJournalAppendOutputRequest,
): RuntimeJournalAppendOutputReceipt {
  return protocolCapture(RUNTIME_PERSISTENCE_RPC_METHOD.journalAppendOutput, "invalid_response", () => {
    const record = exactRecord(
      value,
      ["status", "conversationId", "eventId", "sequence", "recordedAt"],
    );
    if (record.status !== "appended" && record.status !== "duplicate") throw new Error();
    const receipt = Object.freeze({
      status: record.status,
      conversationId: identity(record.conversationId),
      eventId: identity(record.eventId),
      sequence: positiveInteger(record.sequence),
      recordedAt: timestamp(record.recordedAt),
    });
    if (
      receipt.conversationId !== request.conversationId ||
      receipt.eventId !== request.snapshot.id
    ) {
      throw new RuntimePersistenceProtocolError(
        "identity_mismatch",
        RUNTIME_PERSISTENCE_RPC_METHOD.journalAppendOutput,
      );
    }
    return receipt;
  });
}

export function captureRuntimeMessagesListRequest(
  value: unknown,
): ConversationMessageFileQuery {
  return protocolCapture(RUNTIME_PERSISTENCE_RPC_METHOD.messagesList, "invalid_request", () => {
    const record = exactRecord(
      value,
      ["conversationId"],
      ["afterMessageIndex", "highWatermarkMessageIndex", "limit", "allowUnknownMessageTypes"],
    );
    return Object.freeze({
      conversationId: identity(record.conversationId),
      ...(record.afterMessageIndex === undefined
        ? {}
        : { afterMessageIndex: nonNegativeInteger(record.afterMessageIndex) }),
      ...(record.highWatermarkMessageIndex === undefined
        ? {}
        : { highWatermarkMessageIndex: nonNegativeInteger(record.highWatermarkMessageIndex) }),
      ...(record.limit === undefined ? {} : { limit: boundedLimit(record.limit) }),
      ...(record.allowUnknownMessageTypes === undefined
        ? {}
        : { allowUnknownMessageTypes: booleanValue(record.allowUnknownMessageTypes) }),
    });
  });
}

export function captureRuntimeMessagesListResponse(
  value: unknown,
  request: ConversationMessageFileQuery,
): ConversationMessageFilePage {
  return protocolCapture(RUNTIME_PERSISTENCE_RPC_METHOD.messagesList, "invalid_response", () => {
    const record = exactRecord(
      captureJsonValue(value),
      [
        "conversationId",
        "items",
        "highWatermarkMessageIndex",
        "projectedThroughSequence",
        "hasMore",
      ],
      ["nextAfterMessageIndex"],
    );
    const conversationId = identity(record.conversationId);
    if (conversationId !== request.conversationId || !Array.isArray(record.items)) {
      throw new Error();
    }
    const items = Object.freeze(
      record.items.map((item) => captureMessageRecord(
        item,
        conversationId,
        request.allowUnknownMessageTypes ?? false,
      )),
    );
    const highWatermarkMessageIndex = nonNegativeInteger(record.highWatermarkMessageIndex);
    const projectedThroughSequence = nonNegativeInteger(record.projectedThroughSequence);
    const afterMessageIndex = request.afterMessageIndex;
    const requestedHighWatermarkMessageIndex = request.highWatermarkMessageIndex;
    if (
      items.length > (request.limit ?? MAX_QUERY_LIMIT) ||
      items.some((item) => item.messageIndex > highWatermarkMessageIndex) ||
      items.some((item) => item.source.sequence > projectedThroughSequence) ||
      (afterMessageIndex !== undefined &&
        items.some((item) => item.messageIndex <= afterMessageIndex)) ||
      (requestedHighWatermarkMessageIndex !== undefined &&
        highWatermarkMessageIndex > requestedHighWatermarkMessageIndex)
    ) {
      throw new Error();
    }
    assertStrictAscending(items.map((item) => item.messageIndex));
    const hasMore = booleanValue(record.hasMore);
    const nextAfterMessageIndex = record.nextAfterMessageIndex === undefined
      ? undefined
      : nonNegativeInteger(record.nextAfterMessageIndex);
    if (hasMore !== (nextAfterMessageIndex !== undefined)) throw new Error();
    return Object.freeze({
      conversationId,
      items,
      highWatermarkMessageIndex,
      projectedThroughSequence,
      hasMore,
      ...(nextAfterMessageIndex === undefined ? {} : { nextAfterMessageIndex }),
    });
  });
}

export function captureRuntimeStateLoadRequest(value: unknown): RuntimeStateLoadRequest {
  return protocolCapture(RUNTIME_PERSISTENCE_RPC_METHOD.runtimeStateLoad, "invalid_request", () => {
    const record = exactRecord(value, ["conversationId"]);
    return Object.freeze({ conversationId: identity(record.conversationId) });
  });
}

export function captureRuntimeRecoverySnapshot(
  value: unknown,
  expectedConversationId?: string,
): RuntimeRecoverySnapshot {
  return protocolCapture(RUNTIME_PERSISTENCE_RPC_METHOD.runtimeStateLoad, "invalid_response", () => {
    const record = exactRecord(
      captureJsonValue(value),
      ["schemaVersion", "conversationId", "capturedThroughSequence"],
      ["nudge", "contextCheckpoint", "interaction"],
    );
    if (record.schemaVersion !== RUNTIME_RECOVERY_SNAPSHOT_SCHEMA_VERSION) throw new Error();
    const conversationId = identity(record.conversationId);
    if (expectedConversationId !== undefined && conversationId !== expectedConversationId) {
      throw new RuntimePersistenceProtocolError(
        "identity_mismatch",
        RUNTIME_PERSISTENCE_RPC_METHOD.runtimeStateLoad,
      );
    }
    const capturedThroughSequence = nonNegativeInteger(record.capturedThroughSequence);
    const nudge = record.nudge === undefined
      ? undefined
      : capturePendingNudgeStoreSnapshot(record.nudge, capturedThroughSequence);
    const contextCheckpoint = record.contextCheckpoint === undefined
      ? undefined
      : captureStrictContextCheckpoint(record.contextCheckpoint);
    if (
      contextCheckpoint !== undefined &&
      (contextCheckpoint.conversationId !== conversationId ||
        contextCheckpoint.coveredThroughSequence > capturedThroughSequence)
    ) {
      throw new Error();
    }
    const interaction = record.interaction === undefined
      ? undefined
      : captureInteractionSnapshot(record.interaction, conversationId);
    return deepFreeze({
      schemaVersion: RUNTIME_RECOVERY_SNAPSHOT_SCHEMA_VERSION,
      conversationId,
      capturedThroughSequence,
      ...(nudge === undefined ? {} : { nudge }),
      ...(contextCheckpoint === undefined ? {} : { contextCheckpoint }),
      ...(interaction === undefined ? {} : { interaction }),
    });
  });
}

export function encodeRuntimePersistencePayload(value: unknown): JsonValue {
  return captureJsonValue(value);
}

function captureOutputSnapshot(value: unknown, conversationId: string): OutputEventSnapshot {
  const captured = captureJsonValue(value);
  const snapshot = coreEventSchemaRegistry.validateOutput(captured, {
    allowUnknownEventType: true,
  });
  if (snapshot.conversationId !== conversationId) {
    throw new RuntimePersistenceProtocolError(
      "identity_mismatch",
      RUNTIME_PERSISTENCE_RPC_METHOD.journalAppendOutput,
    );
  }
  return deepFreeze(snapshot);
}

function capturePersistedEvent(value: unknown, conversationId: string) {
  return deepFreeze(
    validatePersistedConversationEventSnapshot(captureJsonValue(value), conversationId),
  );
}

function captureMessageRecord(
  value: unknown,
  conversationId: string,
  allowUnknownMessageTypes: boolean,
): MessageProjectionMessageRecord {
  const record = exactRecord(value, [
    "recordType", "formatVersion", "workspaceId", "conversationId", "messageIndex",
    "source", "message", "previousHash", "recordHash",
  ]);
  if (record.recordType !== "message" || record.formatVersion !== MESSAGE_PROJECTION_FORMAT_VERSION) {
    throw new Error();
  }
  const source = exactRecord(record.source, ["sequence", "eventId", "eventType", "direction", "ordinal"]);
  if (!isEventType(source.eventType as string)) throw new Error();
  const message = coreRuntimeMessageSchemaRegistry.validateSnapshot(
    captureJsonValue(record.message),
    { allowUnknownMessageType: allowUnknownMessageTypes },
  );
  if (message.conversationId !== conversationId || record.conversationId !== conversationId) {
    throw new Error();
  }
  return deepFreeze({
    recordType: "message",
    formatVersion: MESSAGE_PROJECTION_FORMAT_VERSION,
    workspaceId: identity(record.workspaceId),
    conversationId,
    messageIndex: positiveInteger(record.messageIndex),
    source: {
      sequence: positiveInteger(source.sequence),
      eventId: identity(source.eventId),
      eventType: source.eventType as string,
      direction: eventDirection(source.direction),
      ordinal: nonNegativeInteger(source.ordinal),
    },
    message,
    previousHash: hash(record.previousHash),
    recordHash: hash(record.recordHash),
  });
}

function capturePendingNudgeStoreSnapshot(value: unknown, throughSequence: number) {
  const record = exactRecord(value, ["schemaVersion", "nudges", "leases", "consumptions"]);
  if (record.schemaVersion !== 1 || !Array.isArray(record.nudges) ||
      !Array.isArray(record.leases) || !Array.isArray(record.consumptions)) throw new Error();
  const nudges = Object.freeze(record.nudges.map((entry) => {
    assertPendingNudgeKeys(entry);
    const nudge = capturePendingNudge(entry);
    if (nudge.scheduledSequence > throughSequence) throw new Error();
    return nudge;
  }));
  const leases = Object.freeze(record.leases.map((entry) => {
    assertNudgeLeaseKeys(entry);
    return captureNudgeLease(entry);
  }));
  const consumptions = Object.freeze(record.consumptions.map(captureNudgeConsumption));
  return deepFreeze({ schemaVersion: 1 as const, nudges, leases, consumptions });
}

function captureStrictContextCheckpoint(value: unknown) {
  const record = exactRecord(
    value,
    [
      "schemaVersion", "id", "conversationId", "sourceStartSequence",
      "sourceEndSequence", "coveredThroughSequence", "sourceDigest", "summary",
      "facts", "decisions", "constraints", "unresolvedTasks", "pinnedMessageIds",
      "recentWindowStartSequence", "tokenEstimateBefore", "tokenEstimateAfter",
      "compactorId", "compactorVersion", "createdAt", "contentDigest",
    ],
    ["parentCheckpointId"],
  );
  for (const field of ["facts", "decisions", "constraints", "unresolvedTasks"] as const) {
    const items = record[field];
    if (!Array.isArray(items)) throw new Error();
    for (const item of items) {
      const itemRecord = exactRecord(item, ["id", "text", "priority", "sourceMessageIds", "artifactReferences"]);
      if (!Array.isArray(itemRecord.artifactReferences)) throw new Error();
      for (const artifact of itemRecord.artifactReferences) {
        exactRecord(
          artifact,
          ["schemaVersion", "artifactId", "conversationId", "contentType", "byteLength", "digest"],
          ["tokenEstimate", "filename"],
        );
      }
    }
  }
  return captureContextCheckpoint(record);
}

function assertPendingNudgeKeys(value: unknown): void {
  exactRecord(
    value,
    ["id", "policyId", "templateId", "templateVersion", "priority", "dedupeKey", "parameters",
      "exclusive", "placement", "delivery", "state", "targetRunId", "scheduledSequence", "scheduledAt"],
    ["targetTurnNumber", "cooldownTurns", "expiresAfterTurn", "expiresAt"],
  );
}

function assertNudgeLeaseKeys(value: unknown): void {
  exactRecord(value, ["leaseId", "providerCallId", "targetRunId", "nudgeIds", "leasedAt"], ["targetTurnNumber"]);
}

function captureNudgeConsumption(value: unknown) {
  const record = exactRecord(
    value,
    ["nudgeId", "policyId", "dedupeKey", "leaseId", "providerCallId", "targetRunId", "leasedAt", "consumedAt"],
    ["targetTurnNumber"],
  );
  return Object.freeze({
    nudgeId: nonBlank(record.nudgeId),
    policyId: nonBlank(record.policyId),
    dedupeKey: nonBlank(record.dedupeKey),
    leaseId: nonBlank(record.leaseId),
    providerCallId: nonBlank(record.providerCallId),
    targetRunId: nonBlank(record.targetRunId),
    ...(record.targetTurnNumber === undefined ? {} : { targetTurnNumber: positiveInteger(record.targetTurnNumber) }),
    leasedAt: timestamp(record.leasedAt),
    consumedAt: timestamp(record.consumedAt),
  });
}

function captureInteractionSnapshot(
  value: unknown,
  conversationId: string,
): ToolApprovalInteractionSnapshot {
  const record = exactRecord(value, ["schemaVersion", "pending", "resolved"]);
  if (record.schemaVersion !== 1 || !Array.isArray(record.pending) || !Array.isArray(record.resolved)) {
    throw new Error();
  }
  const pending = Object.freeze(record.pending.map((entry) => captureApprovalRequest(entry, conversationId)));
  const resolved = Object.freeze(record.resolved.map((entry) => captureApprovalResolution(entry, conversationId)));
  const ids = [...pending, ...resolved].map((entry) => entry.approvalRequestId);
  if (new Set(ids).size !== ids.length) throw new Error();
  return deepFreeze({ schemaVersion: 1 as const, pending, resolved });
}

function captureApprovalRequest(value: unknown, conversationId: string) {
  const record = exactRecord(value, ["approvalRequestId", "identity", "summary", "requestedAt", "expiresAt"], ["turnId"]);
  const approvalIdentity = captureApprovalIdentity(record.identity);
  if (approvalIdentity.conversationId !== conversationId) throw new Error();
  const summary = exactRecord(record.summary, ["title"], ["description"]);
  const requestedAt = timestamp(record.requestedAt);
  const expiresAt = timestamp(record.expiresAt);
  if (expiresAt <= requestedAt) throw new Error();
  return Object.freeze({
    approvalRequestId: identity(record.approvalRequestId),
    identity: approvalIdentity,
    ...(record.turnId === undefined ? {} : { turnId: identity(record.turnId) }),
    summary: Object.freeze({
      title: boundedText(summary.title, 256),
      ...(summary.description === undefined ? {} : { description: boundedText(summary.description, 1024) }),
    }),
    requestedAt,
    expiresAt,
  });
}

function captureApprovalResolution(value: unknown, conversationId: string) {
  const record = exactRecord(value, ["approvalRequestId", "identity", "decision", "resolvedAt"], ["actorId", "causationId"]);
  const approvalIdentity = captureApprovalIdentity(record.identity);
  if (approvalIdentity.conversationId !== conversationId) throw new Error();
  if (!["approved", "rejected", "cancelled", "expired"].includes(record.decision as string)) throw new Error();
  const actorId = record.actorId === undefined ? undefined : identity(record.actorId);
  if (((record.decision === "approved" || record.decision === "rejected") !== (actorId !== undefined))) throw new Error();
  return Object.freeze({
    approvalRequestId: identity(record.approvalRequestId),
    identity: approvalIdentity,
    decision: record.decision as "approved" | "rejected" | "cancelled" | "expired",
    ...(actorId === undefined ? {} : { actorId }),
    resolvedAt: timestamp(record.resolvedAt),
    ...(record.causationId === undefined ? {} : { causationId: identity(record.causationId) }),
  });
}

function captureAnchor(value: unknown): ConversationEventQueryAnchor {
  const record = plainRecord(value);
  const keys = Object.keys(record);
  if (keys.length !== 1) throw new Error();
  if (record.from === "start" || record.from === "end") return Object.freeze({ from: record.from });
  if (Object.hasOwn(record, "afterSequence")) return Object.freeze({ afterSequence: nonNegativeInteger(record.afterSequence) });
  if (Object.hasOwn(record, "beforeSequence")) return Object.freeze({ beforeSequence: positiveInteger(record.beforeSequence) });
  throw new Error();
}

function eventTypeList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error();
  const captured = value.map((entry) => {
    if (typeof entry !== "string" || !isEventType(entry)) throw new Error();
    return entry;
  });
  if (new Set(captured).size !== captured.length) throw new Error();
  return Object.freeze(captured) as unknown as string[];
}

function captureApprovalIdentity(value: unknown) {
  const record = exactRecord(
    value,
    ["conversationId", "runId", "toolCallId", "toolName", "toolVersion", "argumentDigest"],
  );
  return captureToolApprovalIdentity(captureJsonValue(record));
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  const record = plainRecord(value);
  assertExactKeys(record, [...required, ...optional], required);
  return record;
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error();
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error();
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor) || !descriptor.enumerable) throw new Error();
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed): void {
  const keys = Object.keys(record);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(record, key))) throw new Error();
}

function captureJsonValue(value: unknown): JsonValue {
  return captureJson(value, new Set<object>());
}

function captureJson(value: unknown, seen: Set<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error();
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) throw new Error();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length) throw new Error();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error();
      }
      return Object.freeze(value.map((entry) => captureJson(entry, seen))) as unknown as JsonValue;
    }
    const record = plainRecord(value);
    return Object.freeze(Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, captureJson(entry, seen)])));
  } finally {
    seen.delete(value);
  }
}

function protocolCapture<T>(method: RuntimePersistenceRpcMethod, failure: "invalid_request" | "invalid_response", operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof RuntimePersistenceProtocolError) throw error;
    throw new RuntimePersistenceProtocolError(failure, method);
  }
}

function identity(value: unknown): string {
  if (typeof value !== "string" || !SAFE_IDENTITY.test(value)) throw new Error();
  return value;
}

function nonBlank(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error();
  return value;
}

function boundedText(value: unknown, maximumBytes: number): string {
  const text = nonBlank(value);
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new Error();
  return text;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error();
  return value;
}

function positiveInteger(value: unknown): number {
  const captured = nonNegativeInteger(value);
  if (captured < 1) throw new Error();
  return captured;
}

function boundedLimit(value: unknown): number {
  const limit = positiveInteger(value);
  if (limit > MAX_QUERY_LIMIT) throw new Error();
  return limit;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error();
  return value;
}

function eventDirection(value: unknown): "input" | "output" {
  if (value !== "input" && value !== "output") throw new Error();
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error();
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error();
  return value;
}

function assertStrictAscending(values: readonly number[]): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index]! <= values[index - 1]!) throw new Error();
  }
}

function matchesEventQuery(
  event: ReturnType<typeof capturePersistedEvent>,
  query: ConversationEventQuery,
): boolean {
  if (query.direction !== undefined && event.direction !== query.direction) return false;
  if (query.eventTypes !== undefined && !query.eventTypes.includes(event.eventType)) return false;
  if (query.runId !== undefined && event.runId !== query.runId) return false;
  if (query.turnId !== undefined && event.turnId !== query.turnId) return false;
  if ("afterSequence" in query.anchor && event.sequence <= query.anchor.afterSequence) return false;
  if ("beforeSequence" in query.anchor && event.sequence >= query.anchor.beforeSequence) return false;
  return true;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
