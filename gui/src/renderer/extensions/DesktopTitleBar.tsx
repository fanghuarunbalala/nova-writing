/**
 * DesktopTitleBar
 *
 * 桌面专属 titleBar 内容（spec 4.2 / 5.1 extensions/）。通过 extensions.titleBar
 * 注入到 TopBarMenuSlot，渲染在顶栏 workspace 名之后。
 *
 * 内容：
 * - 版本徽章（"Desktop vX.X.X"）
 * - 窗口控制按钮（minimize / maximize / close），仅在 window port 注入时渲染
 *
 * 设计约束：
 * - window port 经 props 注入（来自 createDesktopPlatformApi），缺失时不渲染按钮
 * - 按钮使用语义化 aria-label，键盘可达
 * - 点击触发 port 方法，错误由调用方 catch（Phase B.3 仅记日志，不弹错误提示）
 * - 不依赖 NovelAppContext：版本在构建时确定；window port 经显式 props 注入
 *
 * Phase B.3 后续：接入 application-update 后追加"有更新"指示；接入 local-runtime
 * 后追加运行时状态。
 */
import type { ComponentType } from "react";
import type { DesktopWindowPort } from "../../shared/index.js";
import styles from "./DesktopTitleBar.module.css";

const DESKTOP_VERSION = "0.1.0"; // 与 gui/package.json 同步；Phase B.2 后改为运行时读取

export interface DesktopTitleBarProps {
  readonly window?: DesktopWindowPort;
}

const handleAction = (port: DesktopWindowPort | undefined, action: (port: DesktopWindowPort) => Promise<void>) => {
  if (port === undefined) return;
  void action(port).catch(() => {
    // Phase B.3：窗口操作失败仅吞错；后续接入 toast 时再提示
  });
};

export const DesktopTitleBar: ComponentType<DesktopTitleBarProps> = ({ window }) => {
  return (
    <span className={styles.titleBar} aria-label="桌面版本与窗口控制">
      <span className={styles.badge}>Desktop</span>
      <span className={styles.version}>v{DESKTOP_VERSION}</span>
      {window !== undefined ? (
        <span className={styles.controls} role="group" aria-label="窗口控制">
          <button
            type="button"
            className={styles.controlButton}
            aria-label="最小化窗口"
            onClick={() => handleAction(window, (port) => port.minimize())}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.controlButton}
            aria-label="最大化窗口"
            onClick={() => handleAction(window, (port) => port.maximize())}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button
            type="button"
            className={`${styles.controlButton} ${styles.closeButton}`}
            aria-label="关闭窗口"
            onClick={() => handleAction(window, (port) => port.close())}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
              <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </span>
      ) : null}
    </span>
  );
};
