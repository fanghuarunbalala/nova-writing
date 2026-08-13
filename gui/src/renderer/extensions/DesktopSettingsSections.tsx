/**
 * DesktopSettingsSections
 *
 * 桌面专属设置 section 集合（spec 5.1 extensions/）。当前仅 "about" 一个 section，
 * 展示应用版本；Phase B.3 接入 application-update 后追加 "updates" section，
 * 接入 desktop-settings 后追加 "appearance" / "window" 等 section。
 *
 * 通过 createDesktopUiExtensions 注入到 NovelUiExtensions.settingsSections，
 * 由共享 SettingsDialog 渲染。
 */
import type { ComponentType } from "react";
import type { NovelSettingsSection } from "@novel/ui";

const DESKTOP_VERSION = "0.1.0"; // 与 gui/package.json 同步；Phase B.2 改为运行时读取

const AboutSection: ComponentType = () => {
  return (
    <div className="novel-desktop-about">
      <h3>Novel Desktop</h3>
      <dl>
        <dt>版本</dt>
        <dd>{DESKTOP_VERSION}</dd>
        <dt>构建</dt>
        <dd>electron</dd>
      </dl>
      <p className="novel-desktop-about-hint">
        桌面端基于 Electron；窗口控制、自动更新、系统托盘等能力将随 Phase B.2/B.3 落地。
      </p>
    </div>
  );
};

export const desktopSettingsSections: readonly NovelSettingsSection[] = Object.freeze([
  Object.freeze({
    id: "desktop-about",
    title: "关于",
    component: AboutSection,
  }),
]);
