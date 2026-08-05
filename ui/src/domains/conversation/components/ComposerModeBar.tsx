/**
 * ComposerModeBar
 *
 * 输入模式切换：chat/plan/rewrite/continue。
 */
import { Tabs } from "../../../shared/primitives/Tabs.js";
import type { ComposerMode } from "../store/ComposerDraftStore.js";
import styles from "./ComposerModeBar.module.css";

const MODE_TABS: ReadonlyArray<{ readonly value: ComposerMode; readonly label: string }> = [
  { value: "chat", label: "对话" },
  { value: "plan", label: "计划" },
  { value: "rewrite", label: "改写" },
  { value: "continue", label: "续写" },
];

export interface ComposerModeBarProps {
  readonly mode: ComposerMode;
  readonly onChange: (mode: ComposerMode) => void;
  readonly disabled?: boolean;
}

export function ComposerModeBar({ mode, onChange, disabled = false }: ComposerModeBarProps) {
  const tabs = MODE_TABS.map((tab) => ({
    value: tab.value,
    label: tab.label,
    disabled: disabled || tab.value === "continue",
  }));
  return (
    <div className={styles.bar}>
      <Tabs
        value={mode}
        onValueChange={(value) => onChange(value as ComposerMode)}
        tabs={tabs}
        variant="pill"
      />
    </div>
  );
}
