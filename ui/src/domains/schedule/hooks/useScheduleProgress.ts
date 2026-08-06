/**
 * useScheduleProgress
 *
 * 订阅 schedule 快照的 progressTree。
 */
import { useMemo } from "react";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { ScheduleStore } from "../store/ScheduleStore.js";

export function useScheduleProgress(store: ScheduleStore) {
  const snapshot = useExternalStore(store);
  return useMemo(
    () =>
      Object.freeze({
        tree: snapshot.progressTree,
        phase: snapshot.phase,
      }),
    [snapshot],
  );
}
