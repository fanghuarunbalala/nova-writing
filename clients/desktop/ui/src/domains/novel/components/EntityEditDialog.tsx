/**
 * EntityEditDialog
 *
 * 角色/地点档案编辑对话框（core CharacterInput = LocationInput 同构）。
 * create/update 双模式：update 带初始值（detail）与 baseRevision 由宿主在
 * onSubmit 时拼乐观锁参数。别名用逗号分隔的文本框输入。
 */
import { useState } from "react";
import type { CharacterInput } from "@novel/core";
import { Button, Dialog, Input, Textarea } from "../../../shared/primitives/index.js";
import styles from "./EntityEditDialog.module.css";

export interface EntityEditInitial {
  /** 名字 */
  readonly name: string;
  /** 别名 */
  readonly aliases: readonly string[];
  /** 摘要 */
  readonly summary: string;
  /** 初始状态 */
  readonly initialState: string;
  /** 作者备注 */
  readonly authorNotes: string;
}

export interface EntityEditDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 实体标签（标题：如「新建角色」/「编辑角色」） */
  readonly entityLabel: string;
  /** update 模式的初始值（create 模式 undefined） */
  readonly initial?: EntityEditInitial;
  /** 提交（返回后自动关闭；宿主拼 create/update mutation 与乐观锁参数） */
  readonly onSubmit: (input: CharacterInput) => Promise<void> | void;
  /** 表单内错误提示（如 stale） */
  readonly error?: string;
}

export function EntityEditDialog({
  open,
  onOpenChange,
  entityLabel,
  initial,
  onSubmit,
  error,
}: EntityEditDialogProps) {
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [summary, setSummary] = useState("");
  const [initialState, setInitialState] = useState("");
  const [authorNotes, setAuthorNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>(undefined);

  // open 切换时同步初始值（create 模式清空）
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    setLocalError(undefined);
    setName(initial?.name ?? "");
    setAliases((initial?.aliases ?? []).join("，"));
    setSummary(initial?.summary ?? "");
    setInitialState(initial?.initialState ?? "");
    setAuthorNotes(initial?.authorNotes ?? "");
  }

  const canSubmit = name.trim() !== "" && !submitting;
  const displayError = localError ?? error;

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const input: CharacterInput = {
        name: name.trim(),
        aliases: aliases
          .split(/[,，]/)
          .map((alias) => alias.trim())
          .filter((alias) => alias !== ""),
        ...(summary.trim() !== "" ? { summary: summary.trim() } : {}),
        ...(initialState.trim() !== "" ? { initialState: initialState.trim() } : {}),
        ...(authorNotes.trim() !== "" ? { authorNotes: authorNotes.trim() } : {}),
      };
      await onSubmit(input);
      onOpenChange(false);
    } catch (err) {
      // 保存失败：留在对话框并展示错误（不吞掉）
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
      title={initial === undefined ? `新建${entityLabel}` : `编辑${entityLabel}`}
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
          <span className={styles.label}>名字 *</span>
          <Input
            value={name}
            placeholder="如：苏眉"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>别名（逗号分隔）</span>
          <Input
            value={aliases}
            placeholder="如：苏姑娘，眉娘"
            onChange={(event) => setAliases(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>摘要</span>
          <Textarea
            rows={3}
            value={summary}
            placeholder="一句话档案摘要"
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>初始状态</span>
          <Textarea
            rows={3}
            value={initialState}
            placeholder="故事开始时的状态"
            onChange={(event) => setInitialState(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>作者备注</span>
          <Textarea
            rows={3}
            value={authorNotes}
            placeholder="设定细节备忘"
            onChange={(event) => setAuthorNotes(event.target.value)}
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
