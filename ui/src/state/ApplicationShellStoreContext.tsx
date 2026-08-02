/** React binding for an injected or locally created ApplicationShellStore. */
import {
  createContext,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ApplicationShellStore,
  type ApplicationShellSnapshot,
  type ApplicationShellState,
} from "./ApplicationShellStore.js";

export interface ApplicationShellStoreProviderProps {
  readonly store?: ApplicationShellStore;
  readonly initialState?: ApplicationShellState;
  readonly children?: ReactNode;
}

const ApplicationShellStoreContext = createContext<
  ApplicationShellStore | undefined
>(undefined);

export function ApplicationShellStoreProvider({
  store,
  initialState,
  children,
}: ApplicationShellStoreProviderProps) {
  const localStore = useRef<ApplicationShellStore | undefined>(undefined);
  localStore.current ??= new ApplicationShellStore(initialState);
  return (
    <ApplicationShellStoreContext.Provider value={store ?? localStore.current}>
      {children}
    </ApplicationShellStoreContext.Provider>
  );
}

export function useApplicationShellStore(): ApplicationShellStore {
  const store = useContext(ApplicationShellStoreContext);
  if (store === undefined) {
    throw new Error("ApplicationShellStoreProvider is required");
  }
  return store;
}

export function useApplicationShellSnapshot(): ApplicationShellSnapshot {
  const store = useApplicationShellStore();
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );
}
