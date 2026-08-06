/**
 * NovelAppContext
 *
 * 把 api/platform/extensions/logger/commandSource/configurationClient 聚合成单一
 * Context 暴露给深层组件（spec 4.0.2）。同时仍向下兼容 FrontendPlatformContext
 * 与 NovelUiExtensionsContext，避免重复消费方迁移。
 */
import { createContext } from "react";
import type { Logger, NovelApiClient } from "@novel/core";
import type { ApplicationCommandSource } from "../command/ApplicationCommandSource.js";
import type { ApplicationConfigurationClient } from "../settings/ApplicationConfigurationClient.js";
import type { FrontendPlatform } from "../platform/FrontendPlatform.js";
import type { NovelUiExtensions } from "../extensions/NovelUiExtensions.js";

export interface NovelAppContextValue {
  readonly api: NovelApiClient;
  readonly platform: FrontendPlatform;
  readonly logger: Logger;
  readonly extensions: NovelUiExtensions;
  readonly commandSource?: ApplicationCommandSource;
  readonly configurationClient?: ApplicationConfigurationClient;
}

export const NovelAppContext = createContext<NovelAppContextValue | null>(null);
