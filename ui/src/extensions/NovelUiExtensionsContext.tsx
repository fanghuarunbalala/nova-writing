/** Captures shell-provided UI extensions without dynamic plugin loading. */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  emptyNovelUiExtensions,
  type NovelUiExtensions,
} from "./NovelUiExtensions.js";

export interface NovelUiExtensionsProviderProps {
  readonly extensions?: NovelUiExtensions;
  readonly children?: ReactNode;
}

const NovelUiExtensionsContext = createContext<NovelUiExtensions>(
  emptyNovelUiExtensions,
);

export function NovelUiExtensionsProvider({
  extensions,
  children,
}: NovelUiExtensionsProviderProps) {
  const value = useMemo(
    () => captureNovelUiExtensions(extensions),
    [extensions],
  );
  return (
    <NovelUiExtensionsContext.Provider value={value}>
      {children}
    </NovelUiExtensionsContext.Provider>
  );
}

export function useNovelUiExtensions(): NovelUiExtensions {
  return useContext(NovelUiExtensionsContext);
}

function captureNovelUiExtensions(
  extensions: NovelUiExtensions | undefined,
): NovelUiExtensions {
  if (extensions === undefined) return emptyNovelUiExtensions;
  assertUniqueIds("route", extensions.routes);
  assertUniqueIds("sidebar panel", extensions.sidebarPanels);
  assertUniqueIds("inspector panel", extensions.inspectorPanels);
  assertUniqueIds("settings section", extensions.settingsSections);
  assertUniqueIds("command", extensions.commands);
  return Object.freeze({
    ...(extensions.titleBar !== undefined
      ? { titleBar: extensions.titleBar }
      : {}),
    routes: captureEntries(extensions.routes),
    sidebarPanels: captureEntries(extensions.sidebarPanels),
    inspectorPanels: captureEntries(extensions.inspectorPanels),
    settingsSections: captureEntries(extensions.settingsSections),
    commands: captureEntries(extensions.commands),
  });
}

function captureEntries<T extends object>(
  entries: readonly T[] | undefined,
): readonly Readonly<T>[] {
  return Object.freeze(
    (entries ?? []).map((entry) => Object.freeze({ ...entry })),
  );
}

function assertUniqueIds(
  category: string,
  entries: readonly { readonly id: string }[] | undefined,
): void {
  const ids = new Set<string>();
  for (const entry of entries ?? []) {
    if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
      throw new TypeError(`Novel UI ${category} id must not be blank`);
    }
    if (ids.has(entry.id)) {
      throw new TypeError(`Novel UI ${category} id must be unique`);
    }
    ids.add(entry.id);
  }
}
