/**
 * TopBarViewSwitcher
 *
 * 主区视图四段切换：对话 / 内容 / 计划 / 书库（lucide 图标 + 文字）。
 * 激活态为滑块（.thumb）——translateX 按列索引位移，等宽四列 grid 保证槽位精确。
 */
import { BookOpen, CalendarDays, Library, MessageSquare, type LucideIcon } from "lucide-react";
import type { MainViewState } from "../../shared/routing/MainViewRouter.js";
import { Icon } from "../../shared/primitives/Icon.js";
import styles from "./TopBarViewSwitcher.module.css";

export interface TopBarViewSwitcherProps {
  readonly state: MainViewState;
  readonly onChange: (state: MainViewState) => void;
  /** 书库视图（试验功能）开关：false 时隐藏第四视图（缺省隐藏） */
  readonly libraryEnabled?: boolean;
}

const VIEWS: ReadonlyArray<{
  readonly value: MainViewState;
  readonly label: string;
  readonly icon: LucideIcon;
}> = [
  { value: "chat", label: "对话", icon: MessageSquare },
  { value: "content", label: "内容", icon: BookOpen },
  { value: "schedule", label: "计划", icon: CalendarDays },
  { value: "library", label: "书库", icon: Library },
];

export function TopBarViewSwitcher({ state, onChange, libraryEnabled = false }: TopBarViewSwitcherProps) {
  const views = VIEWS.filter((view) => view.value !== "library" || libraryEnabled);
  const activeIndex = Math.max(
    0,
    views.findIndex((view) => view.value === state),
  );
  return (
    <div className={styles.switcher} role="tablist" aria-label="主视图">
      <span
        className={styles.thumb}
        style={{ transform: `translateX(calc(${activeIndex} * 100%))` }}
        aria-hidden="true"
      />
      {views.map((view) => (
        <button
          key={view.value}
          type="button"
          role="tab"
          aria-selected={state === view.value}
          className={[styles.seg, state === view.value ? styles.active : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onChange(view.value)}
        >
          <Icon icon={view.icon} size="sm" />
          <span>{view.label}</span>
        </button>
      ))}
    </div>
  );
}
