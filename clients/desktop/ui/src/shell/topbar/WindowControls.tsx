/**
 * WindowControls
 *
 * 自绘窗口控制（PRD WC-1/2/4；决议 5）：
 * - Windows：右缘三钮（最小化 / 最大化·还原 / 关闭），关闭悬停 #e81123 白字；
 * - macOS：左缘红绿灯（#ff5f57 / #febc2e / #28c840），hover 组内显形符号；
 *   实际接入用系统红绿灯（titleBarStyle:"hidden"）时宿主可不传 mac 渲染。
 * 平台差异由 platform 决定，与顶栏 drag 区解耦（按钮均 no-drag）。
 */
import { memo } from "react";
import { Minus, Square, SquareDashed, X } from "lucide-react";
import { Icon } from "../../shared/primitives/Icon.js";
import styles from "./WindowControls.module.css";

export type WindowControlsPlatform = "win" | "mac";

export interface WindowChromeProps {
  readonly platform: WindowControlsPlatform;
  /** 最大化状态（true 时 Windows 中间钮切换为「向下还原」图标） */
  readonly maximized?: boolean;
  readonly onMinimize: () => void;
  readonly onToggleMaximize: () => void;
  readonly onClose: () => void;
}

/** 自绘窗口控制（memo：流式发布期间跳过） */
export const WindowControls = memo(function WindowControls({
  platform,
  maximized = false,
  onMinimize,
  onToggleMaximize,
  onClose,
}: WindowChromeProps) {
  if (platform === "mac") {
    return (
      <div className={styles.traffic} aria-label="窗口控制">
        <button
          type="button"
          className={`${styles.tl} ${styles.tlClose}`}
          onClick={onClose}
          aria-label="关闭"
          title="关闭"
        >
          <Icon icon={X} size="xs" />
        </button>
        <button
          type="button"
          className={`${styles.tl} ${styles.tlMin}`}
          onClick={onMinimize}
          aria-label="最小化"
          title="最小化"
        >
          <Icon icon={Minus} size="xs" />
        </button>
        <button
          type="button"
          className={`${styles.tl} ${styles.tlMax}`}
          onClick={onToggleMaximize}
          aria-label={maximized ? "向下还原" : "最大化"}
          title={maximized ? "向下还原" : "最大化"}
        >
          <Icon icon={maximized ? SquareDashed : Square} size="xs" />
        </button>
      </div>
    );
  }
  return (
    <div className={styles.winCtl} aria-label="窗口控制">
      <button type="button" className={styles.wbtn} onClick={onMinimize} aria-label="最小化" title="最小化">
        <Icon icon={Minus} size="sm" />
      </button>
      <button
        type="button"
        className={styles.wbtn}
        onClick={onToggleMaximize}
        aria-label={maximized ? "向下还原" : "最大化"}
        title={maximized ? "向下还原" : "最大化"}
      >
        <Icon icon={maximized ? SquareDashed : Square} size="sm" />
      </button>
      <button
        type="button"
        className={`${styles.wbtn} ${styles.wclose}`}
        onClick={onClose}
        aria-label="关闭"
        title="关闭"
      >
        <Icon icon={X} size="sm" />
      </button>
    </div>
  );
});
