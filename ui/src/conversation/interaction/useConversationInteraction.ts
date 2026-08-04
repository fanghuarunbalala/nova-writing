/** Builds scenario view models and the unified command surface from one projection. */
import { useMemo } from "react";
import type { ConversationProjectionHookResult } from "../useConversationProjection.js";
import { useConversationRuntimeStatus } from "../useConversationRuntimeStatus.js";
import { createConversationInteractionCommands } from "./ConversationInteractionCommands.js";
import type {
  ConversationInteraction,
  ConversationRuntimeScenario,
  ConversationTimelineScenario,
} from "./ConversationInteractionTypes.js";

const FAILURE_STATUSES = new Set([
  "not_configured",
  "invalid_configuration",
  "missing_credential",
  "missing_manifest",
  "crashed",
]);

export function useConversationInteraction(
  result: ConversationProjectionHookResult,
  failureCode?: string,
): ConversationInteraction {
  const conversationId = result.snapshot.conversationId;
  const commands = useMemo(
    () =>
      createConversationInteractionCommands({
        conversationId,
        enqueue: result.enqueue,
      }),
    [conversationId, result.enqueue],
  );
  const runtimeStatus = useConversationRuntimeStatus(result.snapshot, failureCode);
  const scenarios = useMemo(
    () => buildScenarios(result.snapshot),
    [result.snapshot],
  );
  const runtime: ConversationRuntimeScenario = useMemo(
    () => ({
      status: runtimeStatus.status,
      ...(runtimeStatus.failureCode === undefined
        ? {}
        : { failureCode: runtimeStatus.failureCode }),
      canStop: runtimeStatus.status === "generating",
      canRetry: FAILURE_STATUSES.has(runtimeStatus.status),
      canOpenSettings: FAILURE_STATUSES.has(runtimeStatus.status),
    }),
    [runtimeStatus],
  );
  return useMemo(
    () => ({ scenarios, runtime, commands }),
    [commands, runtime, scenarios],
  );
}

function buildScenarios(
  snapshot: ConversationProjectionHookResult["snapshot"],
): readonly ConversationTimelineScenario[] {
  const projection = snapshot.projection;
  const userTextByRunId = new Map<string, string>();
  for (const user of projection.userMessages) {
    if (user.runId !== undefined) userTextByRunId.set(user.runId, user.text);
  }
  const fallbackText =
    projection.userMessages[projection.userMessages.length - 1]?.text ?? "";
  return projection.timeline.map((item): ConversationTimelineScenario => {
    if (item.kind === "user-message") {
      return {
        kind: "user-message",
        eventId: item.eventId,
        sequence: item.sequence,
        timestamp: item.timestamp,
        text: item.text,
        ...(item.runId === undefined ? {} : { runId: item.runId }),
      };
    }
    if (item.kind === "assistant-message") {
      return {
        kind: "assistant-message",
        assistantMessageId: item.assistantMessageId,
        runId: item.runId,
        timestamp: item.timestamp,
        status: item.status,
        content: item.content,
        ...(item.completionReason === undefined
          ? {}
          : { completionReason: item.completionReason }),
        ...(item.hasToolCalls === undefined ? {} : { hasToolCalls: item.hasToolCalls }),
        ...(item.failureCode === undefined ? {} : { failureCode: item.failureCode }),
        userText: userTextByRunId.get(item.runId) ?? fallbackText,
      };
    }
    return {
      kind: "tool-approval",
      approvalRequestId: item.approvalRequestId,
      toolName: item.toolName,
      toolVersion: item.toolVersion,
      argumentDigest: item.argumentDigest,
      title: item.title,
      ...(item.description === undefined ? {} : { description: item.description }),
      requestedAt: item.requestedAt,
      status: item.status,
    };
  });
}
