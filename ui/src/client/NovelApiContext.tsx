/** Injects the platform-neutral Novel API used by shared React components. */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  noopLogger,
  type Logger,
  type NovelApiClient,
} from "@novel/core";

export interface NovelApiContextValue {
  readonly api: NovelApiClient;
  readonly logger: Logger;
}

export interface NovelApiProviderProps {
  readonly api: NovelApiClient;
  readonly logger?: Logger;
  readonly children?: ReactNode;
}

const NovelApiContext = createContext<NovelApiContextValue | undefined>(
  undefined,
);

export function NovelApiProvider({
  api,
  logger = noopLogger,
  children,
}: NovelApiProviderProps) {
  const value = useMemo<NovelApiContextValue>(
    () =>
      Object.freeze({
        api,
        logger: logger.child({ component: "novel_ui" }),
      }),
    [api, logger],
  );
  return (
    <NovelApiContext.Provider value={value}>
      {children}
    </NovelApiContext.Provider>
  );
}

export function useNovelApi(): NovelApiContextValue {
  const value = useContext(NovelApiContext);
  if (value === undefined) {
    throw new Error("NovelApiProvider is required");
  }
  return value;
}
