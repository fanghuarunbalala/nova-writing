/**
 * StoryUnitEditDialog
 *
 * 大纲单元编辑对话框：title/intent/synopsis/scope。
 * create/update 双模式：update 带初始值（core StoryUnit）与 baseRevision 由宿主
 * 在 onSubmit 时拼乐观锁参数。
 */
import { useState } from "react";
import type { StoryUnitScope } from "@novel/core";
import { Button, Dialog } from "../../../../shared/primitives/index.js";
import styles from "../../components/EntityEditDialog.module.css";

export interface StoryUnitEditInitial {
  readonly title: string;
  readonly intent: string;
  readonly synopsis: string;
  readonly scope?: StoryUnitScope;
}

export interface StoryUnitEditInput {
  readonly title: string;
  readonly intent?: string;
  readonly synopsis?: string;
  readonly scope?: StoryUnitScope;
}

export interface StoryUnitEditDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 模式标题（如「编辑大纲单元」/「新建子单元」） */
  readonly title: string;
  /** update 模式的初始值（create 模式 undefined） */
  readonly initial?: StoryUnitEditInitial;
  readonly onSubmit: (input: StoryUnitEditInput) => Promise<void> | void;
  /** 表单内错误提示（如 stale） */
  readonly error?: string;
}

const SCOPES: readonly { value: StoryUnitScope; label: string }[] = [
  { value: "saga", label: "saga 长篇" },
  { value: "arc", label: "arc 卷/弧" },
  { value: "sequence", label: "sequence 序列" },
  { value: "scene", label: "scene 场景" },
  { value: "custom", label: "custom 自定义" },
];

export function StoryUnitEditDialog({
  open,
  onOpenChange,
  title,
  initial,
  onSubmit,
  error,
}: StoryUnitEditDialogProps) {
  const [unitTitle, setUnitTitle] = useState("");
  const [intent, setIntent] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [scope, setScope] = useState<StoryUnitScope>("scene");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>(undefined);

  // open 切换时同步初始值（create 模式清空）
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    setLocalError(undefined);
    setUnitTitle(initial?.title ?? "");
    setIntent(initial?.intent ?? "");
    setSynopsis(initial?.synopsis ?? "");
    setScope(initial?.scope ?? "scene");
  }

  const canSubmit = unitTitle.trim() !== "" && !submitting;
  const displayError = localError ?? error;

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: unitTitle.trim(),
        ...(intent.trim() !== "" ? { intent: intent.trim() } : {}),
        ...(synopsis.trim() !== "" ? { synopsis: synopsis.trim() } : {}),
        scope,
      });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLocalError(`保存失败：${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" disabled={!canSubmit} loading={submitting} onClick={() => void handleSubmit()}>
            保存
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.label}>标题 *</span>
          <input
            className={styles.input}
            value={unitTitle}
            placeholder="如：第一章 金陵秋"
            onChange={(event) => setUnitTitle(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>层级（scope）</span>
          <select
            className={styles.input}
            value={scope}
            onChange={(event) => setScope(event.target.value as StoryUnitScope)}
          >
            {SCOPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>意图（intent）</span>
          <textarea
            className={styles.textarea}
            rows={3}
            value={intent}
            placeholder="本单元想达成的叙事目的"
            onChange={(event) => setIntent(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>梗概（synopsis）</span>
          <textarea
            className={styles.textarea}
            rows={4}
            value={synopsis}
            placeholder="情节梗概"
            onChange={(event) => setSynopsis(event.target.value)}
          />
        </label>
        {displayError !== undefined && displayError !== "" ? (
          <div className={styles.error} role="alert">
            {displayError}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
