/**
 * useScheduleOverview
 *
 * 订阅 schedule 快照的 stats / axisFlow。
 */
import { useMemo } from "react";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { ScheduleStore } from "../store/ScheduleStore.js";

export function useScheduleOverview(store: ScheduleStore) {
  const snapshot = useExternalStore(store);
  return useMemo(
    () =>
      Object.freeze({
        stats: snapshot.stats,
        axisFlow: snapshot.axisFlow,
        phase: snapshot.phase,
      }),
    [snapshot],
  );
}
