/**
 * useStoryOutlineTree
 *
 * 订阅大纲树 store 并提供本地视图动作。
 */
import { useCallback, useMemo } from "react";
import { useExternalStore } from "../../../../shared/state/useExternalStore.js";
import type { StoryOutlineTreeStore } from "../store/StoryOutlineTreeStore.js";

export function useStoryOutlineTree(store: StoryOutlineTreeStore) {
  const snapshot = useExternalStore(store);
  const selectUnit = useCallback(
    (unitId: string | undefined) => store.selectUnit(unitId),
    [store],
  );
  const toggleExpand = useCallback((unitId: string) => store.toggleExpand(unitId), [store]);
  const expandAll = useCallback(() => store.expandAll(), [store]);
  const collapseAll = useCallback(() => store.collapseAll(), [store]);
  return useMemo(
    () => Object.freeze({ snapshot, selectUnit, toggleExpand, expandAll, collapseAll }),
    [collapseAll, expandAll, selectUnit, snapshot, toggleExpand],
  );
}
