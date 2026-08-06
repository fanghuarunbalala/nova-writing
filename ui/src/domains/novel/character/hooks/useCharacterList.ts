/**
 * useCharacterList
 *
 * 订阅角色列表 store。
 */
import { useExternalStore } from "../../../../shared/state/useExternalStore.js";
import type { CharacterStore } from "../store/CharacterStore.js";

export function useCharacterList(store: CharacterStore) {
  return useExternalStore(store);
}
