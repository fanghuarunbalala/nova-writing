/** Provides the shared canonical Novel read cache to Novel UI components. */
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  NovelReadCache,
  createNovelReadCache,
} from "./NovelReadCache.js";

const NovelReadCacheContext = createContext<NovelReadCache | undefined>(
  undefined,
);

export function NovelReadCacheProvider({
  children,
}: {
  readonly children?: ReactNode;
}) {
  const cache = useMemo(() => createNovelReadCache(), []);
  return (
    <NovelReadCacheContext.Provider value={cache}>
      {children}
    </NovelReadCacheContext.Provider>
  );
}

export function useNovelReadCache(): NovelReadCache {
  const cache = useContext(NovelReadCacheContext);
  if (cache === undefined) {
    throw new Error("NovelReadCacheProvider is required");
  }
  return cache;
}
