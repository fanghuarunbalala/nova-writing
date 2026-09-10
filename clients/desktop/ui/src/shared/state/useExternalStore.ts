/**
 * useExternalStore
 *
 * useSyncExternalStore 的封装，提供类型推断。
 * 用法：const snapshot = useExternalStore(store);
 */
import { useSyncExternalStore } from "react";

export function useExternalStore<S>(
  store: {
    readonly subscribe: (listener: () => void) => () => void;
    readonly getSnapshot: () => S;
  },
): S {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
