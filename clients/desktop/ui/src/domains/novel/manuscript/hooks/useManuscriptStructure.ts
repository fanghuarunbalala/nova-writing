/**
 * useManuscriptStructure
 *
 * 订阅手稿结构 store。加载由 shell 顶层 effect 触发。
 */
import { useExternalStore } from "../../../../shared/state/useExternalStore.js";
import type { ManuscriptStructureStore } from "../store/ManuscriptStructureStore.js";

export function useManuscriptStructure(store: ManuscriptStructureStore) {
  return useExternalStore(store);
}
