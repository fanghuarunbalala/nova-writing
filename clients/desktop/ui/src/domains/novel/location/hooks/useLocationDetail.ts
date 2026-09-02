/**
 * useLocationDetail
 *
 * 从 detailCache 读取地点详情；未缓存时触发懒加载。
 */
import { useCallback, useMemo } from "react";
import { useExternalStore } from "../../../../shared/state/useExternalStore.js";
import type { LocationStore } from "../store/LocationStore.js";

export function useLocationDetail(
  store: LocationStore,
  locationId: string | undefined,
) {
  const snapshot = useExternalStore(store);
  const loadDetail = useCallback(
    (id: string) => store.loadDetail(id),
    [store],
  );
  return useMemo(() => {
    if (locationId === undefined) {
      return { detail: undefined, loadDetail };
    }
    if (snapshot.detailCache.get(locationId) === undefined) {
      void store.loadDetail(locationId);
    }
    return { detail: snapshot.detailCache.get(locationId), loadDetail };
  }, [locationId, loadDetail, snapshot.detailCache, store]);
}
