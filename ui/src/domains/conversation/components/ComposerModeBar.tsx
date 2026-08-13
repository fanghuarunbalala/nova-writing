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
import { useEffect, useRef, useState, type ReactNode } from "react";
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

export interface ComposerModeBarProps {
  readonly mode: ComposerMode;
  readonly onChange: (mode: ComposerMode) => void;
  readonly disabled?: boolean;
}

/** 模式图标（原型 m-ico / o-ico，16×16 stroke-width 1.6）。 */
function ModeIcon({ tone }: { readonly tone: ComposerModeTone }): ReactNode {
  switch (tone) {
    case "compose":
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4.5 2h4.5L12 4.5V13a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
          <path d="M8.5 2v3h3" />
          <path d="M5.5 9h5M5.5 11h3" />
        </svg>
      );
    case "bypass":
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.5 1.5L3 9h4l-1 5.5L13 7H8.5l1-5.5z" />
        </svg>
      );
    case "review":
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 1.5l5 2v3.5c0 3.3-2.2 5.6-5 7.5-2.8-1.9-5-4.2-5-7.5V3.5l5-2z" />
          <path d="M5.5 8l2 2 3-3.5" />
        </svg>
      );
  }
}

export function ComposerModeBar({ mode, onChange, disabled = false }: ComposerModeBarProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current =
    COMPOSER_MODES.find((item) => item.value === mode) ?? COMPOSER_MODES[0]!;

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
          <ModeIcon tone={current.tone} />
        </span>
        <span className={styles.triggerName}>{current.label}</span>
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
                  <ModeIcon tone={item.tone} />
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
