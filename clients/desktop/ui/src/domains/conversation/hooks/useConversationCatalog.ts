/**
 * useConversationCatalog
 *
 * 订阅 ConversationCatalogStore 快照并暴露 store 动作。
 * 说明：spec 无参签名依赖未定义的域 context；这里显式接收 store，
 * 由 Phase 3 shell 组合层持有并注入。
 */
import { useCallback, useMemo } from "react";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { ConversationCatalogStore } from "../store/ConversationCatalogStore.js";

export function useConversationCatalog(store: ConversationCatalogStore) {
  const snapshot = useExternalStore(store);
  const createConversation = useCallback(() => store.createConversation(), [store]);
  const selectConversation = useCallback(
    (id: string) => store.selectConversation(id),
    [store],
  );
  const retry = useCallback(() => store.retry(), [store]);
  return useMemo(
    () => Object.freeze({ snapshot, createConversation, selectConversation, retry }),
    [createConversation, retry, selectConversation, snapshot],
  );
}
