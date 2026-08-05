/**
 * DesktopTitleBar
 *
 * 桌面专属 titleBar 内容（spec 4.2 / 5.1 extensions/）。通过 extensions.titleBar
 * 注入到 TopBarMenuSlot，渲染在顶栏 workspace 名之后。
 *
 * 当前内容：版本徽章。Phase B.3 接入 application-update 后追加"有更新"指示；
 * 接入 local-runtime 后追加运行时状态。
 *
 * 不依赖 NovelAppContext：版本在构建时确定；运行时状态后续由 Phase B.3 通过
 * context 或 props 注入。
 */
import type { ComponentType } from "react";
import styles from "./DesktopTitleBar.module.css";

const DESKTOP_VERSION = "0.1.0"; // 与 gui/package.json 同步；Phase B.2 后改为运行时读取

export const DesktopTitleBar: ComponentType = () => {
  return (
    <span className={styles.titleBar} aria-label="桌面版本">
      <span className={styles.badge}>Desktop</span>
      <span className={styles.version}>v{DESKTOP_VERSION}</span>
    </span>
  );
};
