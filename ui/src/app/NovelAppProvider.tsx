/**
 * NovelAppProvider
 *
 * 顶层 Context 提供者（spec 4.0.2）。把宿主注入的 api/platform/extensions/logger/
 * commandSource/configurationClient 同时发布到三个 context：
 *   - NovelAppContext（聚合，便于一次性读取）
 *   - FrontendPlatformContext（兼容 useFrontendPlatform）
 *   - NovelUiExtensionsContext（兼容 useNovelUiExtensions，含 id 唯一性校验）
 *
 * 这样既保留单一聚合入口，又复用既有细粒度 hook，避免深层组件因 NovelAppContext
 * 任意字段变化而被迫重渲染。
 */
import { useContext, useMemo, type ReactElement, type ReactNode } from "react";
import type { Logger, NovelApiClient } from "@novel/core";
import { NovelAppContext, type NovelAppContextValue } from "./NovelAppContext.js";
import { FrontendPlatformProvider } from "../platform/FrontendPlatformContext.js";
import {
  NovelUiExtensionsProvider,
  useNovelUiExtensions,
} from "../extensions/NovelUiExtensionsContext.js";
import type { ApplicationCommandSource } from "../command/ApplicationCommandSource.js";
import type { ApplicationConfigurationClient } from "../settings/ApplicationConfigurationClient.js";
import type { FrontendPlatform } from "../platform/FrontendPlatform.js";
import type { NovelUiExtensions } from "../extensions/NovelUiExtensions.js";

export interface NovelAppProviderProps {
  readonly api: NovelApiClient;
  readonly platform: FrontendPlatform;
  readonly logger: Logger;
  readonly extensions?: NovelUiExtensions;
  readonly commandSource?: ApplicationCommandSource;
  readonly configurationClient?: ApplicationConfigurationClient;
  readonly children: ReactNode;
}

export function NovelAppProvider(props: NovelAppProviderProps): ReactElement {
  const { api, platform, logger, commandSource, configurationClient, children } = props;
  // NovelUiExtensionsProvider 内部做 id 唯一性校验与 freeze，先让它把 extensions 规范化
  return (
    <NovelUiExtensionsProvider extensions={props.extensions}>
      <NovelAppProviderInner
        api={api}
        platform={platform}
        logger={logger}
        commandSource={commandSource}
        configurationClient={configurationClient}
      >
        {children}
      </NovelAppProviderInner>
    </NovelUiExtensionsProvider>
  );
}

function NovelAppProviderInner({
  api,
  platform,
  logger,
  commandSource,
  configurationClient,
  children,
}: Omit<NovelAppProviderProps, "extensions">): ReactElement {
  const extensions = useNovelUiExtensions();
  const value = useMemo<NovelAppContextValue>(
    () => ({
      api,
      platform,
      logger,
      extensions,
      ...(commandSource !== undefined ? { commandSource } : {}),
      ...(configurationClient !== undefined ? { configurationClient } : {}),
    }),
    [api, platform, logger, extensions, commandSource, configurationClient],
  );
  return (
    <FrontendPlatformProvider platform={platform}>
      <NovelAppContext.Provider value={value}>{children}</NovelAppContext.Provider>
    </FrontendPlatformProvider>
  );
}

export function useNovelApp(): NovelAppContextValue {
  const value = useContext(NovelAppContext);
  if (value === null) {
    throw new Error("NovelAppProvider is required; wrap consumers in <NovelAppProvider>");
  }
  return value;
}

export function useNovelApi(): NovelApiClient {
  return useNovelApp().api;
}
