/** Derives the desktop Runtime status from one replay-safe projection snapshot. */
import {
  classifyConversationRuntimeStatus,
  type ConversationRuntimeStatus,
} from "@novel/core";
import type { ConversationProjectionBindingSnapshot } from "./ConversationProjectionBindingTypes.js";

export interface ConversationRuntimeStatusResult {
  readonly status: ConversationRuntimeStatus;
  readonly failureCode?: string;
}

export function useConversationRuntimeStatus(
  snapshot: ConversationProjectionBindingSnapshot,
  failureCode?: string,
): ConversationRuntimeStatusResult {
  const projection = snapshot.projection;
  const presence =
    projection.runtimePresence ??
    Object.freeze({ state: "offline" as const, observedAt: "" });
  const latestRun = projection.runs[projection.runs.length - 1];
  const latestTurn = projection.turns[projection.turns.length - 1];
  const status = classifyConversationRuntimeStatus({
    presence,
    runStatus: latestRun?.current,
    turnStatus: latestTurn?.current,
    failureCode,
  });
  return Object.freeze({
    status,
    ...(failureCode === undefined ? {} : { failureCode }),
  });
}
