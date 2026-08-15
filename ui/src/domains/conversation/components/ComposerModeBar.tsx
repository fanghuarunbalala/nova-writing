/**
 * ComposerModeBar
 *
 * 执行模式下拉（对齐原型 .mode-panel + .mode-trigger + .mode-options）：
 *   触发按钮 = 当前模式图标（随 tone 变色）+ 模式名 + 倒三角 chevron，
 *   aria-expanded/aria-haspopup；选项面板从发送框上方浮出（bottom:calc(100%+4px)），
 *   每项含图标 + 名称 + 描述，当前项 .sel 高亮（按 tone 染色）。
 *   交互：点击 trigger 开合；点击选项选中并收起；外部 pointerdown / Escape 关闭
 *   （Escape 关闭后焦点回到 trigger）。mode 仍为会话级权威状态，切换由上层
 *   enqueue ConversationModeSetInputEvent 到 core（决策 2：沿用 ui/ 三模式语义，
 *   仅做面板结构 + 图标改造）。
 */
import { useEffect, useRef, useState } from "react";
import { PenLine, ShieldCheck, Zap, type LucideIcon } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { ComposerMode } from "../store/ComposerDraftStore.js";
import styles from "./ComposerModeBar.module.css";

export type ComposerModeTone = "compose" | "bypass" | "review";

export interface ComposerModeMeta {
  readonly value: ComposerMode;
  readonly label: string;
  readonly description: string;
  readonly tone: ComposerModeTone;
}

export const COMPOSER_MODES: readonly ComposerModeMeta[] = Object.freeze([
  { value: "review", label: "需审核", description: "提议后审批提交", tone: "review" },
  { value: "bypass", label: "直接执行", description: "跳过审批 · 立即落地", tone: "bypass" },
  { value: "compose", label: "设计", description: "仅草稿文件可写", tone: "compose" },
]);

/** mode → label 查表（助手消息头部 chip 复用；单一来源，改文案只动上面 COMPOSER_MODES） */
export const COMPOSER_MODE_META: Readonly<Record<ComposerMode, string>> = Object.freeze(
  Object.fromEntries(COMPOSER_MODES.map((item) => [item.value, item.label])) as Record<ComposerMode, string>,
);

export interface ComposerModeBarProps {
  readonly mode: ComposerMode;
  readonly onChange: (mode: ComposerMode) => void;
  readonly disabled?: boolean;
  /** 待生效模式（mode.pending 事件派生）：非 undefined 且不同于 mode 时显示「待生效」提示 */
  readonly pendingMode?: ComposerMode;
}

/** 模式图标（原型 m-ico / o-ico 语义，统一 lucide：审核=盾、直执=闪电、设计=笔）。 */
const MODE_ICONS: Record<ComposerModeTone, LucideIcon> = {
  review: ShieldCheck,
  bypass: Zap,
  compose: PenLine,
};

export function ComposerModeBar({ mode, onChange, disabled = false, pendingMode }: ComposerModeBarProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current =
    COMPOSER_MODES.find((item) => item.value === mode) ?? COMPOSER_MODES[0]!;
  // 待生效提示：pendingMode 已记录且与当前 active 不同（mode.pending 事件已到、mode.changed 未到）
  const pendingLabel =
    pendingMode !== undefined && pendingMode !== current.value
      ? COMPOSER_MODES.find((item) => item.value === pendingMode)?.label
      : undefined;

  // 打开期间：外部 pointerdown 关闭；Escape 关闭并把焦点还给 trigger。
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent): void => {
      if (panelRef.current !== null && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleSelect = (next: ComposerModeMeta): void => {
    setOpen(false);
    if (disabled || next.value === current.value) return;
    onChange(next.value);
  };

  return (
    <div className={styles.panel} ref={panelRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`执行模式：${current.label}`}
      >
        <span className={`${styles.triggerIcon} ${styles[`icon-${current.tone}`]}`} aria-hidden="true">
          <Icon icon={MODE_ICONS[current.tone]} size="md" />
        </span>
        <span className={styles.triggerName}>{current.label}</span>
        {pendingLabel !== undefined ? (
          <span className={styles.pendingChip} title={`待生效：${pendingLabel}`}>
            待生效
          </span>
        ) : null}
        <span className={[styles.chev, open ? styles.chevOpen : ""].filter(Boolean).join(" ")} aria-hidden="true" />
      </button>
      {open ? (
        <div className={styles.options} role="menu" aria-label="执行模式">
          {COMPOSER_MODES.map((item) => {
            const selected = item.value === current.value;
            return (
              <button
                key={item.value}
                type="button"
                role="menuitem"
                className={[
                  styles.option,
                  selected ? styles.selected : "",
                  styles[`opt-${item.tone}`],
                ].filter(Boolean).join(" ")}
                aria-selected={selected}
                onClick={() => handleSelect(item)}
              >
                <span className={styles.optionIcon} aria-hidden="true">
                  <Icon icon={MODE_ICONS[item.tone]} size="md" />
                </span>
                <span className={styles.optionText}>
                  <span className={styles.optionName}>{item.label}</span>
                  <span className={styles.optionDesc}>{item.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
