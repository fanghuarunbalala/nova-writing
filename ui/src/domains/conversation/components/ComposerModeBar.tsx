/**
 * ComposerModeBar
 *
 * 执行模式切换（对齐原型 .mode-bar + .mode-switch）：单个循环切换按钮
 * （模式名 + 描述 + chevron），右侧模式提示点。
 * 点击按 草案 → 直接执行 → 审批 → 草案 循环（原型 MODE_ORDER）。
 */
import type { ComposerMode } from "../store/ComposerDraftStore.js";
import styles from "./ComposerModeBar.module.css";

export type ComposerModeTone = "plan" | "bypass" | "review";

export interface ComposerModeMeta {
  readonly value: ComposerMode;
  readonly label: string;
  readonly description: string;
  readonly tone: ComposerModeTone;
}

export const COMPOSER_MODES: readonly ComposerModeMeta[] = Object.freeze([
  { value: "plan", label: "草案", description: "只规划 · 不产生变更", tone: "plan" },
  { value: "bypass", label: "直接执行", description: "跳过审批 · 立即落地", tone: "bypass" },
  { value: "review", label: "审批", description: "提议后审批提交", tone: "review" },
]);

export interface ComposerModeBarProps {
  readonly mode: ComposerMode;
  readonly onChange: (mode: ComposerMode) => void;
  readonly disabled?: boolean;
}

export function ComposerModeBar({ mode, onChange, disabled = false }: ComposerModeBarProps) {
  const current =
    COMPOSER_MODES.find((item) => item.value === mode) ?? COMPOSER_MODES[0];
  const handleClick = (): void => {
    if (disabled) return;
    const index = COMPOSER_MODES.findIndex((item) => item.value === current.value);
    const next = COMPOSER_MODES[(index + 1) % COMPOSER_MODES.length];
    onChange(next.value);
  };
  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={`${styles.switch} ${styles[current.tone]}`}
        onClick={handleClick}
        disabled={disabled}
        aria-label={`执行模式：${current.label}，点击切换`}
        title={`点击切换：${COMPOSER_MODES.map((item) => item.label).join(" → ")}`}
      >
        <span className={styles.name}>{current.label}</span>
        <span className={styles.desc}>{current.description}</span>
        <span className={styles.chev}>点击切换</span>
      </button>
      <span className={styles.hint}>
        {COMPOSER_MODES.map((item) => (
          <span key={item.value} className={styles.hintItem}>
            <i
              className={`${styles.dot} ${styles[`dot-${item.tone}`]}`}
              aria-hidden="true"
            />
            {item.label}
          </span>
        ))}
      </span>
    </div>
  );
}
