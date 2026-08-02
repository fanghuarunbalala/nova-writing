/** Validates and freezes Checkpoint lineage, structured items, and references. */
import { captureArtifactReference } from "../../storage/artifact/index.js";
import {
  CONTEXT_CHECKPOINT_ITEM_PRIORITY,
  CONTEXT_CHECKPOINT_SCHEMA_VERSION,
  type ContextCheckpoint,
  type ContextCheckpointItem,
} from "./ContextCheckpoint.js";
import { CONTEXT_PROTOCOL_VALIDATION_FAILURE } from "./ContextProtocolErrors.js";
import {
  captureIdentity,
  captureNonBlank,
  deepFreeze,
  failure,
  requireDigest,
  requireNonBlank,
  requireNonEmptyUniqueNonBlankStrings,
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireRecord,
  requireTimestamp,
  requireUniqueNonBlankStrings,
} from "./ContextProtocolValidationSupport.js";

const ITEM_PRIORITIES = new Set(Object.values(CONTEXT_CHECKPOINT_ITEM_PRIORITY));

export function captureContextCheckpointItem(
  value: unknown,
): ContextCheckpointItem {
  try {
    return captureItem(value);
  } catch {
    throw failure(CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidCheckpointItem);
  }
}

export function captureContextCheckpoint(value: unknown): ContextCheckpoint {
  const identity = captureIdentity(value);
  try {
    const record = requireRecord(
      value,
      CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidCheckpoint,
      identity,
    );
    if (record.schemaVersion !== CONTEXT_CHECKPOINT_SCHEMA_VERSION) {
      throw new Error();
    }
    const id = requireNonBlank(record.id);
    const conversationId = requireNonBlank(record.conversationId);
    const parentCheckpointId = captureNonBlank(record.parentCheckpointId);
    if (record.parentCheckpointId !== undefined && !parentCheckpointId) {
      throw new Error();
    }
    if (parentCheckpointId === id) throw new Error();
    const sourceStartSequence = requirePositiveInteger(record.sourceStartSequence);
    const sourceEndSequence = requirePositiveInteger(record.sourceEndSequence);
    const coveredThroughSequence = requirePositiveInteger(
      record.coveredThroughSequence,
    );
    const recentWindowStartSequence = requirePositiveInteger(
      record.recentWindowStartSequence,
    );
    if (
      sourceStartSequence > sourceEndSequence ||
      coveredThroughSequence !== sourceEndSequence ||
      recentWindowStartSequence <= coveredThroughSequence
    ) {
      throw new Error();
    }
    const tokenEstimateBefore = requirePositiveInteger(record.tokenEstimateBefore);
    const tokenEstimateAfter = requireNonNegativeInteger(record.tokenEstimateAfter);
    if (tokenEstimateAfter >= tokenEstimateBefore) throw new Error();

    const facts = captureItems(record.facts, conversationId);
    const decisions = captureItems(record.decisions, conversationId);
    const constraints = captureItems(record.constraints, conversationId);
    const unresolvedTasks = captureItems(record.unresolvedTasks, conversationId);
    const itemIds = [facts, decisions, constraints, unresolvedTasks]
      .flat()
      .map((item) => item.id);
    if (new Set(itemIds).size !== itemIds.length) throw new Error();

    return deepFreeze({
      schemaVersion: CONTEXT_CHECKPOINT_SCHEMA_VERSION,
      id,
      conversationId,
      ...(parentCheckpointId === undefined ? {} : { parentCheckpointId }),
      sourceStartSequence,
      sourceEndSequence,
      coveredThroughSequence,
      sourceDigest: requireDigest(record.sourceDigest),
      summary: requireNonBlank(record.summary),
      facts,
      decisions,
      constraints,
      unresolvedTasks,
      pinnedMessageIds: requireUniqueNonBlankStrings(record.pinnedMessageIds),
      recentWindowStartSequence,
      tokenEstimateBefore,
      tokenEstimateAfter,
      compactorId: requireNonBlank(record.compactorId),
      compactorVersion: requireNonBlank(record.compactorVersion),
      createdAt: requireTimestamp(record.createdAt),
      contentDigest: requireDigest(record.contentDigest),
    });
  } catch {
    throw failure(CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidCheckpoint, {
      conversationId: identity.conversationId,
      checkpointId: identity.checkpointId,
    });
  }
}

function captureItems(
  value: unknown,
  conversationId: string,
): readonly ContextCheckpointItem[] {
  if (!Array.isArray(value)) throw new Error();
  return Object.freeze(
    value.map((item) => {
      const captured = captureItem(item);
      if (
        captured.artifactReferences.some(
          (artifact) => artifact.conversationId !== conversationId,
        )
      ) {
        throw new Error();
      }
      return captured;
    }),
  );
}

function captureItem(value: unknown): ContextCheckpointItem {
  const record = requireRecord(
    value,
    CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidCheckpointItem,
  );
  const priority = record.priority;
  if (!ITEM_PRIORITIES.has(priority as never)) throw new Error();
  if (!Array.isArray(record.artifactReferences)) throw new Error();
  const artifactReferences = Object.freeze(
    record.artifactReferences.map(captureArtifactReference),
  );
  const artifactIds = artifactReferences.map((artifact) => artifact.artifactId);
  if (new Set(artifactIds).size !== artifactIds.length) throw new Error();
  return deepFreeze({
    id: requireNonBlank(record.id),
    text: requireNonBlank(record.text),
    priority: priority as ContextCheckpointItem["priority"],
    sourceMessageIds: requireNonEmptyUniqueNonBlankStrings(
      record.sourceMessageIds,
    ),
    artifactReferences,
  });
}
