/**
 * TopBarViewSwitcher
 *
 * 主区视图三段切换：对话 / 内容 / 计划。
 */
import type { MainViewState } from "../../shared/routing/MainViewRouter.js";
import { TopBarAction } from "./TopBarAction.js";
import styles from "./TopBarViewSwitcher.module.css";

export interface TopBarViewSwitcherProps {
  readonly state: MainViewState;
  readonly onChange: (state: MainViewState) => void;
}

const VIEWS: ReadonlyArray<{ readonly value: MainViewState; readonly label: string }> = [
  { value: "chat", label: "对话" },
  { value: "content", label: "内容" },
  { value: "schedule", label: "计划" },
];

export function TopBarViewSwitcher({ state, onChange }: TopBarViewSwitcherProps) {
  return (
    <div className={styles.switcher} role="tablist" aria-label="主视图">
      {VIEWS.map((view) => (
        <button
          key={view.value}
          type="button"
          role="tab"
          aria-selected={state === view.value}
          className={[styles.seg, state === view.value ? styles.active : ""].filter(Boolean).join(" ")}
          onClick={() => onChange(view.value)}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}
