/**
 * useConversationRuntimeStatus
 *
 * 从投影快照派生简化的运行时状态（idle/live/disconnected/failed）。
 * 纯派生 hook：上游 useConversationProjection 提供快照；重试动作由
 * 投影 hook 的 resume() 承担（spec 的 retry 字段在组合层绑定）。
 *
 * 注：spec 的 currentRun.turn 为 number，但 core 的 turnId 是字符串；
 * 这里返回 { runId, turnId }，与 core 投影一致。
 */
import { useMemo } from "react";
import {
  classifyConversationRuntimeStatus,
  CONVERSATION_RUNTIME_STATUS,
  type ConversationProjectionSnapshot,
} from "@novel/core";

export type ConversationRuntimeUiState = "idle" | "live" | "disconnected" | "failed";

export interface ConversationRuntimeStatusResult {
  readonly state: ConversationRuntimeUiState;
  readonly currentRun?: { readonly runId: string; readonly turnId: string };
}

function mapToUiState(
  status: (typeof CONVERSATION_RUNTIME_STATUS)[keyof typeof CONVERSATION_RUNTIME_STATUS],
): ConversationRuntimeUiState {
  switch (status) {
    case CONVERSATION_RUNTIME_STATUS.starting:
    case CONVERSATION_RUNTIME_STATUS.online:
    case CONVERSATION_RUNTIME_STATUS.generating:
      return "live";
    case CONVERSATION_RUNTIME_STATUS.crashed:
      return "failed";
    default:
      return "disconnected";
  }
}

export function useConversationRuntimeStatus(
  projection: ConversationProjectionSnapshot | undefined,
  failureCode?: string,
): ConversationRuntimeStatusResult {
  return useMemo(() => {
    const capturedProjection = projection;
    if (capturedProjection === undefined) {
      return Object.freeze({ state: "idle" as const });
    }
    const presence = capturedProjection.runtimePresence;
    if (presence === undefined) return Object.freeze({ state: "idle" as const });
    const latestRun = capturedProjection.runs[capturedProjection.runs.length - 1];
    const latestTurn = capturedProjection.turns[capturedProjection.turns.length - 1];
    const status = classifyConversationRuntimeStatus({
      presence,
      runStatus: latestRun?.current,
      turnStatus: latestTurn?.current,
      failureCode,
    });
    const state = mapToUiState(status);
    const currentRun =
      latestRun !== undefined
        ? Object.freeze({
            runId: latestRun.runId,
            turnId: latestTurn?.turnId ?? "",
          })
        : undefined;
    return Object.freeze({ state, ...(currentRun !== undefined ? { currentRun } : {}) });
  }, [failureCode, projection]);
}
