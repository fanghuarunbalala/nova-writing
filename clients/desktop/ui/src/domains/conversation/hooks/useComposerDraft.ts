/**
 * useComposerDraft
 *
 * 订阅单条对话草稿并提供 setText/setMode/addReference/removeReference/clear。
 */
import { useCallback, useMemo } from "react";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type {
  ComposerDraftStore,
  ComposerMode,
  ComposerReference,
} from "../store/ComposerDraftStore.js";

export function useComposerDraft(store: ComposerDraftStore, conversationId: string) {
  const snapshots = useExternalStore(store);
  const draft = useMemo(
    () => snapshots.find((item) => item.conversationId === conversationId),
    [conversationId, snapshots],
  );
  const setText = useCallback((text: string) => store.setText(conversationId, text), [conversationId, store]);
  const setMode = useCallback((mode: ComposerMode) => store.setMode(conversationId, mode), [conversationId, store]);
  const addReference = useCallback(
    (reference: ComposerReference) => store.addReference(conversationId, reference),
    [conversationId, store],
  );
  const removeReference = useCallback(
    (id: string) => store.removeReference(conversationId, id),
    [conversationId, store],
  );
  const clear = useCallback(() => store.clear(conversationId), [conversationId, store]);
  const clearReferences = useCallback(
    () => store.clearReferences(conversationId),
    [conversationId, store],
  );
  return useMemo(
    () =>
      Object.freeze({
        draft,
        setText,
        setMode,
        addReference,
        removeReference,
        clear,
        clearReferences,
      }),
    [addReference, clear, clearReferences, draft, removeReference, setMode, setText],
  );
}
