/** React external-store binding for an injected or local InspectorStore. */
import {
  createContext,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  InspectorStore,
  type InspectorSnapshot,
  type InspectorStoreInitialState,
} from "./InspectorStore.js";

export interface InspectorStoreProviderProps {
  readonly store?: InspectorStore;
  readonly initialState?: InspectorStoreInitialState;
  readonly children?: ReactNode;
}

const InspectorStoreContext = createContext<InspectorStore | undefined>(undefined);

export function InspectorStoreProvider({
  store,
  initialState,
  children,
}: InspectorStoreProviderProps) {
  const localStore = useRef<InspectorStore | undefined>(undefined);
  localStore.current ??= new InspectorStore(initialState);
  return (
    <InspectorStoreContext.Provider value={store ?? localStore.current}>
      {children}
    </InspectorStoreContext.Provider>
  );
}

export function useInspectorStore(): InspectorStore {
  const store = useContext(InspectorStoreContext);
  if (store === undefined) throw new Error("InspectorStoreProvider is required");
  return store;
}

export function useInspectorSnapshot(): InspectorSnapshot {
  const store = useInspectorStore();
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );
}
