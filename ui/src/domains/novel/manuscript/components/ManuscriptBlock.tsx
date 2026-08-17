/**
 * ManuscriptBlock
 *
 * 正文段（MS-3：衬线 16.5px / 行高 1.95 / 首行缩进 2em / 两端对齐）。
 * 草稿段（MS-4）：warn 3px 左线 + 6% 底色 + 尾标「草稿 · 未转入正式稿」。
 * 写路径降噪保留：编辑/删除图标 hover 浮现（右上角）；编辑态 textarea。
 */
import { useState } from "react";
import { Feather, Pencil, Trash2 } from "lucide-react";
import { Button, Icon } from "../../../../shared/primitives/index.js";
import type { ManuscriptBlockData } from "../store/ManuscriptStructureStore.js";
import styles from "./ManuscriptBlock.module.css";

export interface ManuscriptBlockProps {
  readonly block: ManuscriptBlockData;
  /** 保存编辑（宿主带乐观锁 baseRevision 调用 store.updateParagraph） */
  readonly onSave?: (text: string) => Promise<void> | void;
  /** 删除段落（宿主确认后执行） */
  readonly onDelete?: () => void;
}

export function ManuscriptBlock({ block, onSave, onDelete }: ManuscriptBlockProps) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(block.text);
  const [saving, setSaving] = useState(false);
  const isDraft = block.isDraft === true;

  if (editing && onSave !== undefined) {
    const save = async (): Promise<void> => {
      setSaving(true);
      try {
        await onSave(draftText);
        setEditing(false);
      } finally {
        setSaving(false);
      }
    };
    return (
      <div className={styles.block} data-block-id={block.blockId}>
        <span className={styles.editingTag}>编辑中</span>
        <textarea
          className={styles.editor}
          rows={6}
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
        />
        <div className={styles.editActions}>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            取消
          </Button>
          <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>
            保存
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={[styles.block, isDraft ? styles.draftBlock : ""].filter(Boolean).join(" ")}
      data-block-id={block.blockId}
    >
      {onSave !== undefined || onDelete !== undefined ? (
        <span className={styles.actions} onClick={(event) => event.stopPropagation()}>
          {onSave !== undefined ? (
            <button
              type="button"
              className={styles.actionButton}
              aria-label="编辑段落"
              title="编辑段落"
              onClick={() => {
                setDraftText(block.text);
                setEditing(true);
              }}
            >
              <Icon icon={Pencil} size="xs" />
            </button>
          ) : null}
          {onDelete !== undefined ? (
            <button
              type="button"
              className={styles.actionButton}
              aria-label="删除段落"
              title="删除段落"
              onClick={onDelete}
            >
              <Icon icon={Trash2} size="xs" />
            </button>
          ) : null}
        </span>
      ) : null}
      {block.text !== "" ? (
        <p className={styles.text}>{block.text}</p>
      ) : (
        <p className={styles.placeholder}>（正文加载中…）</p>
      )}
      {isDraft ? (
        <span className={styles.draftTag}>
          <Icon icon={Feather} size="xs" />
          草稿 · 未转入正式稿
        </span>
      ) : null}
    </div>
  );
}
