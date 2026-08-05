/**
 * createDesktopUiExtensions
 *
 * 桌面端第一方扩展点工厂（spec 5.1 extensions/）。把桌面专属的 titleBar /
 * routes / sidebarPanels / inspectorPanels / settingsSections / commands 装配成
 * NovelUiExtensions，由 DesktopRendererBootstrap 注入 NovelApp。
 *
 * Phase B.2 状态：titleBar（DesktopTitleBar）+ settingsSections（"关于"）。后续：
 * - B.3: commands（结合 application-update / system-tray）
 * - 视需要追加 routes / sidebarPanels / inspectorPanels
 */
import type { NovelUiExtensions } from "@novel/ui";
import { desktopSettingsSections } from "./DesktopSettingsSections.js";
import { DesktopTitleBar } from "./DesktopTitleBar.js";

export function createDesktopUiExtensions(): NovelUiExtensions {
  return Object.freeze({
    titleBar: DesktopTitleBar,
    settingsSections: desktopSettingsSections,
  });
}
