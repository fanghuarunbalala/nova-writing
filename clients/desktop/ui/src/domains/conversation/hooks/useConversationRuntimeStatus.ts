/**
 * useConversationRuntimeStatus
 *
 * 从精简投影快照派生简化运行时状态（idle/live/disconnected/failed）。
 * 映射：running → live；error → failed；stopped → disconnected；idle → idle。
 */
import { useMemo } from "react";
import type { ConversationProjectionSnapshot } from "@novel/core/client";

export type ConversationRuntimeUiState = "idle" | "live" | "disconnected" | "failed";

export interface ConversationRuntimeStatusResult {
  readonly state: ConversationRuntimeUiState;
}

export function useConversationRuntimeStatus(
  projection: ConversationProjectionSnapshot | undefined,
): ConversationRuntimeStatusResult {
  return useMemo(() => {
    if (projection === undefined) return Object.freeze({ state: "idle" as const });
    switch (projection.state) {
      case "running":
        return Object.freeze({ state: "live" as const });
      case "error":
        return Object.freeze({ state: "failed" as const });
      case "stopped":
        return Object.freeze({ state: "disconnected" as const });
      default:
        return Object.freeze({ state: "idle" as const });
    }
  }, [projection]);
}
