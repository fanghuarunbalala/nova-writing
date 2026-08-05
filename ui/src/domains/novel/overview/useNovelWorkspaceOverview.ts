/**
 * useNovelWorkspaceOverview
 *
 * 订阅 NovelOverviewStore 快照。加载由 shell 顶层 effect（spec 1.5.1）触发，
 * 本 hook 只读不触发副作用。
 */
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { NovelOverviewStore } from "./NovelOverviewStore.js";

export function useNovelWorkspaceOverview(store: NovelOverviewStore) {
  return useExternalStore(store);
}
