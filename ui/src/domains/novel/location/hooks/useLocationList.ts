/**
 * useLocationList
 *
 * 订阅地点列表 store。
 */
import { useExternalStore } from "../../../../shared/state/useExternalStore.js";
import type { LocationStore } from "../store/LocationStore.js";

export function useLocationList(store: LocationStore) {
  return useExternalStore(store);
}
