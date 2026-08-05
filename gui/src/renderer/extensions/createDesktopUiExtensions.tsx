/**
 * createDesktopUiExtensions
 *
 * 桌面端第一方扩展点工厂（spec 5.1 extensions/）。把桌面专属的 titleBar /
 * routes / sidebarPanels / inspectorPanels / settingsSections / commands 装配成
 * NovelUiExtensions，由 DesktopRendererBootstrap 注入 NovelApp。
 *
 * Phase B.1 状态：仅 settingsSections（"关于"）。后续 Phase：
 * - B.2: titleBar（依赖 TopBarMenuSlot，需先在 shell 加 slot）
 * - B.2: routes（按需追加桌面专属路由）
 * - B.3: commands（结合 application-update / system-tray）
 */
import type { NovelUiExtensions } from "@novel/ui";
import { desktopSettingsSections } from "./DesktopSettingsSections.js";

export function createDesktopUiExtensions(): NovelUiExtensions {
  return Object.freeze({
    settingsSections: desktopSettingsSections,
  });
}
