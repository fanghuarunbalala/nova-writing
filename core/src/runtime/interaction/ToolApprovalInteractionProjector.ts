/** Rebuilds approval coordinator state from persisted public OutputEvents. */
import { OUTPUT_EVENT_TYPE } from "../../event/output/OutputEventType.js";
import {
  ToolApprovalRequestedPayload,
  ToolApprovalResolvedPayload,
} from "../../event/output/payload/ToolApprovalLifecyclePayloads.js";
import type { PersistedOutputEventSnapshot } from "../../storage/journal/PersistedConversationEventSnapshot.js";
import { captureToolApprovalIdentity } from "../tools/execution/ToolExecutionProtocolValidator.js";
import {
  INTERACTION_COORDINATOR_FAILURE,
  InteractionCoordinatorError,
} from "./InteractionCoordinatorErrors.js";
import type {
  ToolApprovalInteractionSnapshot,
  ToolApprovalRequest,
  ToolApprovalResolution,
} from "./ToolApprovalInteractionProtocol.js";

export function projectToolApprovalInteractionSnapshot(
  events: Iterable<PersistedOutputEventSnapshot>,
): ToolApprovalInteractionSnapshot {
  const pending = new Map<string, ToolApprovalRequest>();
  const resolved = new Map<string, ToolApprovalResolution>();
  const ordered = [...events]
    .filter((event) =>
      event.eventType === OUTPUT_EVENT_TYPE.toolApprovalRequested ||
      event.eventType === OUTPUT_EVENT_TYPE.toolApprovalResolved,
    )
    .sort((left, right) => left.sequence - right.sequence);

  try {
    for (const event of ordered) {
      if (event.eventType === OUTPUT_EVENT_TYPE.toolApprovalRequested) {
        const payload = new ToolApprovalRequestedPayload(
          event.payload as unknown as ConstructorParameters<
            typeof ToolApprovalRequestedPayload
          >[0],
        );
        if (pending.has(payload.approvalRequestId) || resolved.has(payload.approvalRequestId)) {
          throw new Error();
        }
        pending.set(payload.approvalRequestId, Object.freeze({
          approvalRequestId: payload.approvalRequestId,
          identity: captureToolApprovalIdentity({
            conversationId: event.conversationId,
            runId: event.runId,
            toolCallId: payload.toolCallId,
            toolName: payload.toolName,
            toolVersion: payload.toolVersion,
            argumentDigest: payload.argumentDigest,
          }),
          ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
          summary: payload.summary,
          requestedAt: payload.requestedAt,
          expiresAt: payload.expiresAt,
        }));
        continue;
      }

      const payload = new ToolApprovalResolvedPayload(
        event.payload as unknown as ConstructorParameters<
          typeof ToolApprovalResolvedPayload
        >[0],
      );
      const request = pending.get(payload.approvalRequestId);
      if (!request) throw new Error();
      if (
        event.conversationId !== request.identity.conversationId ||
        event.runId !== request.identity.runId ||
        payload.toolCallId !== request.identity.toolCallId ||
        payload.toolName !== request.identity.toolName ||
        payload.toolVersion !== request.identity.toolVersion ||
        payload.argumentDigest !== request.identity.argumentDigest
      ) {
        throw new Error();
      }
      const resolution = Object.freeze({
        approvalRequestId: payload.approvalRequestId,
        identity: request.identity,
        decision: payload.decision,
        ...(payload.actorId === undefined ? {} : { actorId: payload.actorId }),
        resolvedAt: payload.resolvedAt,
        ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
      });
      pending.delete(payload.approvalRequestId);
      resolved.set(payload.approvalRequestId, resolution);
    }
  } catch {
    throw new InteractionCoordinatorError(
      INTERACTION_COORDINATOR_FAILURE.invalidSnapshot,
    );
  }

  return Object.freeze({
    schemaVersion: 1,
    pending: Object.freeze([...pending.values()]),
    resolved: Object.freeze([...resolved.values()]),
  });
}
