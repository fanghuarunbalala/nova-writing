/**
 * createDesktopUiExtensions
 *
 * 桌面端第一方扩展点工厂（spec 5.1 extensions/）。把桌面专属的 titleBar /
 * settingsSections / commands 装配成 NovelUiExtensions，由 DesktopRendererBootstrap
 * 注入 NovelApp。
 *
 * Phase B.3：titleBar 接受 window port prop（用于窗口控制按钮）；通过包装组件
 * 把 port 闭包绑定到 DesktopTitleBar，避免 NovelUiExtensions 消费者感知 port。
 *
 * 后续：
 * - B.3+: commands（结合 application-update / system-tray）
 * - 视需要追加 routes / sidebarPanels / inspectorPanels
 */
import type { ComponentType } from "react";
import type { NovelUiExtensions } from "@novel/ui";
import type { DesktopWindowPort } from "../../shared/index.js";
import { desktopSettingsSections } from "./DesktopSettingsSections.js";
import { DesktopTitleBar } from "./DesktopTitleBar.js";

export interface DesktopUiExtensionsOptions {
  readonly window?: DesktopWindowPort;
}

export function createDesktopUiExtensions(
  options: DesktopUiExtensionsOptions = {},
): NovelUiExtensions {
  const windowPort = options.window;
  // 包装 DesktopTitleBar，把 window port 闭包绑定。当 port 缺失时仍渲染版本徽章。
  const TitledBarBound: ComponentType = () => (
    <DesktopTitleBar window={windowPort} />
  );
  return Object.freeze({
    titleBar: TitledBarBound,
    settingsSections: desktopSettingsSections,
  });
}
