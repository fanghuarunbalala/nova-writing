/** Composes API, platform, and bounded extension providers for shared UI. */
import type { Logger, NovelApiClient } from "@novel/core";
import type { ReactNode } from "react";
import { NovelApiProvider } from "../client/NovelApiContext.js";
import {
  NovelUiExtensionsProvider,
  type NovelUiExtensions,
} from "../extensions/index.js";
import {
  FrontendPlatformProvider,
  type FrontendPlatform,
} from "../platform/index.js";

export interface NovelAppProviderProps {
  readonly api: NovelApiClient;
  readonly platform: FrontendPlatform;
  readonly extensions?: NovelUiExtensions;
  readonly logger?: Logger;
  readonly children?: ReactNode;
}

export function NovelAppProvider({
  api,
  platform,
  extensions,
  logger,
  children,
}: NovelAppProviderProps) {
  return (
    <NovelApiProvider api={api} logger={logger}>
      <FrontendPlatformProvider platform={platform}>
        <NovelUiExtensionsProvider extensions={extensions}>
          {children}
        </NovelUiExtensionsProvider>
      </FrontendPlatformProvider>
    </NovelApiProvider>
  );
}
