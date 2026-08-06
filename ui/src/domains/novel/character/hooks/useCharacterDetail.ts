/**
 * useCharacterDetail
 *
 * 从 detailCache 读取角色详情；未缓存时触发懒加载。
 */
import { useCallback, useMemo } from "react";
import { useExternalStore } from "../../../../shared/state/useExternalStore.js";
import type { CharacterStore } from "../store/CharacterStore.js";

export function useCharacterDetail(
  store: CharacterStore,
  characterId: string | undefined,
) {
  const snapshot = useExternalStore(store);
  const loadDetail = useCallback(
    (id: string) => store.loadDetail(id),
    [store],
  );
  return useMemo(() => {
    if (characterId === undefined) {
      return { detail: undefined, loadDetail };
    }
    const detail = snapshot.detailCache.get(characterId);
    if (detail === undefined) {
      void store.loadDetail(characterId);
    }
    return { detail: snapshot.detailCache.get(characterId), loadDetail };
  }, [characterId, loadDetail, snapshot.detailCache, store]);
}
