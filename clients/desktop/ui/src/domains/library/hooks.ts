/**
 * 书库域 hooks：useExternalStore 薄包装。
 */
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import type { LibrarySnapshot } from "./store/LibraryStore.js";
import type { LibraryStore } from "./store/LibraryStore.js";

/** 订阅书库域快照（书单 + 选区 + 部件缓存 + 导入态） */
export function useLibrary(store: LibraryStore): LibrarySnapshot {
	return useExternalStore(store);
}
