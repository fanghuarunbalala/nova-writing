/** React external-store binding for injected or local Composer draft state. */
import {
  createContext,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ComposerDraftStore,
  type ComposerDraftInitialState,
  type ComposerDraftSnapshot,
} from "./ComposerDraftStore.js";

export interface ComposerDraftStoreProviderProps {
  readonly store?: ComposerDraftStore;
  readonly initialDrafts?: readonly ComposerDraftInitialState[];
  readonly children?: ReactNode;
}

const ComposerDraftStoreContext = createContext<ComposerDraftStore | undefined>(
  undefined,
);

export function ComposerDraftStoreProvider({
  store,
  initialDrafts,
  children,
}: ComposerDraftStoreProviderProps) {
  const localStore = useRef<ComposerDraftStore | undefined>(undefined);
  localStore.current ??= new ComposerDraftStore(initialDrafts);
  return (
    <ComposerDraftStoreContext.Provider value={store ?? localStore.current}>
      {children}
    </ComposerDraftStoreContext.Provider>
  );
}

export function useComposerDraftStore(): ComposerDraftStore {
  const store = useContext(ComposerDraftStoreContext);
  if (store === undefined) throw new Error("ComposerDraftStoreProvider is required");
  return store;
}

export function useComposerDraftBinding(
  conversationId: string,
  explicitStore?: ComposerDraftStore,
): {
  readonly store: ComposerDraftStore;
  readonly snapshot: ComposerDraftSnapshot;
} {
  const contextualStore = useContext(ComposerDraftStoreContext);
  const fallbackStore = useRef<ComposerDraftStore | undefined>(undefined);
  fallbackStore.current ??= new ComposerDraftStore();
  const store = explicitStore ?? contextualStore ?? fallbackStore.current;
  const snapshot = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(conversationId),
    () => store.getSnapshot(conversationId),
  );
  return { store, snapshot };
}
