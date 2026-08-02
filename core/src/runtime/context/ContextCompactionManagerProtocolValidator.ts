/** Captures immutable Compaction sources/results and canonical digest material. */
import {
  canonicalStringifyJson,
  isJsonValue,
  type JsonValue,
} from "../../event/index.js";
import {
  coreRuntimeMessageSchemaRegistry,
  type RuntimeMessageSnapshot,
} from "../message/index.js";
import type { ContextCompactionEffect } from "../policy/RuntimePolicyProtocol.js";
import type { ContextCheckpoint, ContextCheckpointItem } from "./ContextCheckpoint.js";
import {
  captureContextCheckpoint,
  captureContextCheckpointItem,
} from "./ContextCheckpointValidator.js";
import type {
  ContextCompactionSource,
  ContextCompactionSourceMessage,
  ContextCompactorResult,
} from "./ContextCompactionManagerProtocol.js";
import { captureContextPinnedMessageGroup } from "./ContextPinnedMessageGroupValidator.js";
import { deepFreeze } from "./ContextProtocolValidationSupport.js";

export function captureContextCompactionSource(
  value: unknown,
  activeCheckpoint?: ContextCheckpoint,
): ContextCompactionSource {
  const record = requireRecord(value);
  const conversationId = requireNonBlank(record.conversationId);
  const active =
    activeCheckpoint === undefined
      ? undefined
      : captureContextCheckpoint(activeCheckpoint);
  if (active !== undefined && active.conversationId !== conversationId) {
    throw new TypeError("Context Compaction source is invalid");
  }
  const sourceStartSequence = requirePositiveInteger(record.sourceStartSequence);
  const sourceEndSequence = requirePositiveInteger(record.sourceEndSequence);
  if (sourceStartSequence > sourceEndSequence) {
    throw new TypeError("Context Compaction source is invalid");
  }
  if (!Array.isArray(record.messages) || !Array.isArray(record.pinnedGroups)) {
    throw new TypeError("Context Compaction source is invalid");
  }
  const messages = Object.freeze(
    record.messages.map((message) =>
      captureSourceMessage(message, conversationId),
    ),
  );
  assertOrderedMessages(messages);
  const messageIds = messages.map((message) => message.message.id);
  if (new Set(messageIds).size !== messageIds.length) {
    throw new TypeError("Context Compaction source is invalid");
  }
  const pinnedGroups = Object.freeze(
    record.pinnedGroups.map((group) => {
      const captured = captureContextPinnedMessageGroup(group);
      if (captured.conversationId !== conversationId) {
        throw new TypeError("Context Compaction source is invalid");
      }
      return captured;
    }),
  );
  if (new Set(pinnedGroups.map((group) => group.id)).size !== pinnedGroups.length) {
    throw new TypeError("Context Compaction source is invalid");
  }

  if (active === undefined) {
    if (
      messages.length === 0 ||
      sourceStartSequence !== messages[0].sequence ||
      sourceEndSequence !== messages[messages.length - 1].sequence
    ) {
      throw new TypeError("Context Compaction source is invalid");
    }
  } else {
    if (sourceStartSequence !== active.sourceStartSequence) {
      throw new TypeError("Context Compaction source is invalid");
    }
    if (messages.some((message) => message.sequence <= active.coveredThroughSequence)) {
      throw new TypeError("Context Compaction source is invalid");
    }
    const expectedEnd =
      messages.length === 0
        ? active.coveredThroughSequence
        : messages[messages.length - 1].sequence;
    if (sourceEndSequence !== expectedEnd) {
      throw new TypeError("Context Compaction source is invalid");
    }
  }

  return deepFreeze({
    conversationId,
    sourceStartSequence,
    sourceEndSequence,
    messages,
    pinnedGroups,
  });
}

export function captureContextCompactorResult(
  value: unknown,
  input: {
    readonly effect: ContextCompactionEffect;
    readonly source: ContextCompactionSource;
    readonly activeCheckpoint?: ContextCheckpoint;
  },
): ContextCompactorResult {
  const record = requireRecord(value);
  const summary = requireNonBlank(record.summary);
  const facts = captureItems(record.facts, input.source.conversationId);
  const decisions = captureItems(record.decisions, input.source.conversationId);
  const constraints = captureItems(record.constraints, input.source.conversationId);
  const unresolvedTasks = captureItems(
    record.unresolvedTasks,
    input.source.conversationId,
  );
  const items = [facts, decisions, constraints, unresolvedTasks].flat();
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new TypeError("Context Compactor result is invalid");
  }
  const allowedSourceMessageIds = collectAllowedSourceMessageIds(
    input.source,
    input.activeCheckpoint,
  );
  if (
    items.some((item) =>
      item.sourceMessageIds.some((messageId) => !allowedSourceMessageIds.has(messageId)),
    )
  ) {
    throw new TypeError("Context Compactor result is invalid");
  }
  const pinnedMessageIds = requireUniqueNonBlankStrings(record.pinnedMessageIds);
  const expectedPinnedMessageIds = collectPinnedMessageIds(input.source.pinnedGroups);
  if (!arraysEqual(pinnedMessageIds, expectedPinnedMessageIds)) {
    throw new TypeError("Context Compactor result is invalid");
  }
  const recentWindowStartSequence = requirePositiveInteger(
    record.recentWindowStartSequence,
  );
  if (recentWindowStartSequence !== input.source.sourceEndSequence + 1) {
    throw new TypeError("Context Compactor result is invalid");
  }
  const tokenEstimateAfter = requireNonNegativeInteger(record.tokenEstimateAfter);
  if (
    tokenEstimateAfter < input.effect.pressure.irreducibleFloor.totalTokens ||
    tokenEstimateAfter > input.effect.pressure.estimate.totalInputTokens
  ) {
    throw new TypeError("Context Compactor result is invalid");
  }
  return deepFreeze({
    summary,
    facts,
    decisions,
    constraints,
    unresolvedTasks,
    pinnedMessageIds,
    recentWindowStartSequence,
    tokenEstimateAfter,
  });
}

export function collectPinnedMessageIds(
  groups: readonly { readonly messageIds: readonly string[] }[],
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const messageId of group.messageIds) {
      if (seen.has(messageId)) continue;
      seen.add(messageId);
      result.push(messageId);
    }
  }
  return Object.freeze(result);
}

export function canonicalizeContextCompactionSource(
  source: ContextCompactionSource,
  activeCheckpoint?: ContextCheckpoint,
): string {
  const pinnedMessageIds = collectPinnedMessageIds(source.pinnedGroups);
  const material = {
    schemaVersion: 1,
    conversationId: source.conversationId,
    sourceStartSequence: source.sourceStartSequence,
    sourceEndSequence: source.sourceEndSequence,
    parentSourceDigest: activeCheckpoint?.sourceDigest ?? null,
    messages: source.messages,
    pinnedMessageIds,
  };
  if (!isJsonValue(material)) {
    throw new TypeError("Context Compaction source is not canonical JSON");
  }
  return canonicalStringifyJson(material);
}

export function canonicalizeContextCheckpointContent(
  checkpoint: Omit<ContextCheckpoint, "contentDigest">,
): string {
  if (!isJsonValue(checkpoint)) {
    throw new TypeError("Context Checkpoint content is not canonical JSON");
  }
  return canonicalStringifyJson(checkpoint as unknown as JsonValue);
}

export function captureCanonicalSha256Digest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new TypeError("Context digest is invalid");
  }
  return value;
}

function captureSourceMessage(
  value: unknown,
  conversationId: string,
): ContextCompactionSourceMessage {
  const record = requireRecord(value);
  const sequence = requirePositiveInteger(record.sequence);
  const ordinal = requireNonNegativeInteger(record.ordinal);
  const message = captureRuntimeMessage(record.message);
  if (
    message.conversationId !== conversationId ||
    isReminderMessageType(message.messageType)
  ) {
    throw new TypeError("Context Compaction source is invalid");
  }
  return deepFreeze({ sequence, ordinal, message });
}

function isReminderMessageType(messageType: string): boolean {
  return (
    messageType === "system.nudge" ||
    messageType.startsWith("system.nudge.") ||
    messageType === "system.reminder" ||
    messageType.startsWith("system.reminder.")
  );
}

function captureRuntimeMessage(value: unknown): RuntimeMessageSnapshot {
  if (!isJsonValue(value)) {
    throw new TypeError("Context Compaction source Message is invalid");
  }
  const captured = JSON.parse(
    canonicalStringifyJson(value),
  ) as RuntimeMessageSnapshot;
  coreRuntimeMessageSchemaRegistry.validateSnapshot(captured, {
    allowUnknownMessageType: true,
  });
  return deepFreeze(captured);
}

function captureItems(
  value: unknown,
  conversationId: string,
): readonly ContextCheckpointItem[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Context Compactor result is invalid");
  }
  return Object.freeze(
    value.map((item) => {
      const captured = captureContextCheckpointItem(item);
      if (
        captured.artifactReferences.some(
          (artifact) => artifact.conversationId !== conversationId,
        )
      ) {
        throw new TypeError("Context Compactor result is invalid");
      }
      return captured;
    }),
  );
}

function collectAllowedSourceMessageIds(
  source: ContextCompactionSource,
  activeCheckpoint?: ContextCheckpoint,
): Set<string> {
  const allowed = new Set(source.messages.map((entry) => entry.message.id));
  if (activeCheckpoint !== undefined) {
    for (const item of [
      ...activeCheckpoint.facts,
      ...activeCheckpoint.decisions,
      ...activeCheckpoint.constraints,
      ...activeCheckpoint.unresolvedTasks,
    ]) {
      for (const messageId of item.sourceMessageIds) allowed.add(messageId);
    }
  }
  return allowed;
}

function assertOrderedMessages(
  messages: readonly ContextCompactionSourceMessage[],
): void {
  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1];
    const current = messages[index];
    if (
      current.sequence < previous.sequence ||
      (current.sequence === previous.sequence && current.ordinal <= previous.ordinal)
    ) {
      throw new TypeError("Context Compaction source is invalid");
    }
  }
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Context Compaction protocol value is invalid");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Context Compaction protocol value is invalid");
  }
  return value as Record<string, unknown>;
}

function requireNonBlank(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Context Compaction protocol value is invalid");
  }
  return value;
}

function requirePositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Context Compaction protocol value is invalid");
  }
  return value;
}

function requireNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Context Compaction protocol value is invalid");
  }
  return value;
}

function requireUniqueNonBlankStrings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Context Compaction protocol value is invalid");
  }
  const captured = value.map(requireNonBlank);
  if (new Set(captured).size !== captured.length) {
    throw new TypeError("Context Compaction protocol value is invalid");
  }
  return Object.freeze(captured);
}
