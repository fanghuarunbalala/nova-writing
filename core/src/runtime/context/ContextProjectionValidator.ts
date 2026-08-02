/** Validates and freezes one-call Context Projection selections. */
import {
  CONTEXT_PROJECTION_DEGRADATION_LEVEL,
  type ContextProjection,
} from "./ContextProjection.js";
import { CONTEXT_PROTOCOL_VALIDATION_FAILURE } from "./ContextProtocolErrors.js";
import {
  captureIdentity,
  captureNonBlank,
  deepFreeze,
  failure,
  requireNonBlank,
  requireNonNegativeInteger,
  requireRecord,
  requireUniqueNonBlankStrings,
} from "./ContextProtocolValidationSupport.js";

const DEGRADATION_LEVELS = new Set(
  Object.values(CONTEXT_PROJECTION_DEGRADATION_LEVEL),
);

export function captureContextProjection(value: unknown): ContextProjection {
  const identity = captureIdentity(value);
  try {
    const record = requireRecord(
      value,
      CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidProjection,
      identity,
    );
    const checkpointId = captureNonBlank(record.checkpointId);
    if (record.checkpointId !== undefined && !checkpointId) throw new Error();
    const selectedCheckpointItemIds = requireUniqueNonBlankStrings(
      record.selectedCheckpointItemIds,
    );
    const omittedCheckpointItemIds = requireUniqueNonBlankStrings(
      record.omittedCheckpointItemIds,
    );
    if (
      selectedCheckpointItemIds.some((itemId) =>
        omittedCheckpointItemIds.includes(itemId),
      )
    ) {
      throw new Error();
    }
    if (
      checkpointId === undefined &&
      (selectedCheckpointItemIds.length > 0 || omittedCheckpointItemIds.length > 0)
    ) {
      throw new Error();
    }
    const pinnedMessageIds = requireUniqueNonBlankStrings(record.pinnedMessageIds);
    const recentMessageIds = requireUniqueNonBlankStrings(record.recentMessageIds);
    if (pinnedMessageIds.some((messageId) => recentMessageIds.includes(messageId))) {
      throw new Error();
    }
    const degradationLevel = record.degradationLevel;
    if (!DEGRADATION_LEVELS.has(degradationLevel as never)) throw new Error();
    return deepFreeze({
      conversationId: requireNonBlank(record.conversationId),
      providerCallId: requireNonBlank(record.providerCallId),
      ...(checkpointId === undefined ? {} : { checkpointId }),
      selectedCheckpointItemIds,
      omittedCheckpointItemIds,
      pinnedMessageIds,
      recentMessageIds,
      transientMessageCount: requireNonNegativeInteger(record.transientMessageCount),
      degradationLevel: degradationLevel as ContextProjection["degradationLevel"],
      tokenEstimate: requireNonNegativeInteger(record.tokenEstimate),
    });
  } catch {
    throw failure(CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidProjection, {
      conversationId: identity.conversationId,
      providerCallId: identity.providerCallId,
      checkpointId: identity.checkpointId,
    });
  }
}
