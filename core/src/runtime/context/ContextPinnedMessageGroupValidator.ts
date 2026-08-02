/** Validates and freezes immutable Message-group pin declarations. */
import {
  CONTEXT_PIN_GROUP_KIND,
  CONTEXT_PIN_LIFETIME,
  type ContextPinnedMessageGroup,
} from "./ContextPinnedMessageGroup.js";
import { CONTEXT_PROTOCOL_VALIDATION_FAILURE } from "./ContextProtocolErrors.js";
import {
  captureIdentity,
  deepFreeze,
  failure,
  requireNonBlank,
  requireNonEmptyUniqueNonBlankStrings,
  requireNonNegativeInteger,
  requireRecord,
} from "./ContextProtocolValidationSupport.js";

const PIN_KINDS = new Set(Object.values(CONTEXT_PIN_GROUP_KIND));
const PIN_LIFETIMES = new Set(Object.values(CONTEXT_PIN_LIFETIME));

export function captureContextPinnedMessageGroup(
  value: unknown,
): ContextPinnedMessageGroup {
  const identity = captureIdentity(value);
  try {
    const record = requireRecord(
      value,
      CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidPinnedGroup,
      identity,
    );
    const kind = record.kind;
    const lifetime = record.lifetime;
    if (!PIN_KINDS.has(kind as never) || !PIN_LIFETIMES.has(lifetime as never)) {
      throw new Error();
    }
    const captured: ContextPinnedMessageGroup = {
      id: requireNonBlank(record.id),
      conversationId: requireNonBlank(record.conversationId),
      kind: kind as ContextPinnedMessageGroup["kind"],
      lifetime: lifetime as ContextPinnedMessageGroup["lifetime"],
      messageIds: requireNonEmptyUniqueNonBlankStrings(record.messageIds),
      tokenEstimate: requireNonNegativeInteger(record.tokenEstimate),
      ...(record.runId === undefined ? {} : { runId: requireNonBlank(record.runId) }),
      ...(record.turnId === undefined
        ? {}
        : { turnId: requireNonBlank(record.turnId) }),
    };
    if (
      captured.kind === CONTEXT_PIN_GROUP_KIND.currentInput &&
      captured.lifetime !== CONTEXT_PIN_LIFETIME.sliding
    ) {
      throw new Error();
    }
    if (
      captured.kind === CONTEXT_PIN_GROUP_KIND.latestCompleteTurn &&
      captured.lifetime !== CONTEXT_PIN_LIFETIME.sliding
    ) {
      throw new Error();
    }
    return deepFreeze(captured);
  } catch {
    throw failure(CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidPinnedGroup, {
      conversationId: identity.conversationId,
      runId: identity.runId,
    });
  }
}
