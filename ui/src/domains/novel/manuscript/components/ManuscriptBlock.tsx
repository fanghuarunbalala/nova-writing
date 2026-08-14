/**
 * ManuscriptBlock
 *
 * 单个正文块（原型 .block + .b-head + .b-id + .b-dg + .b-draft + p）。
 *
 * 块用 dashed border-top 分隔（首块无边框）；b-head mono/faint；
 * b-draft warn 色；p 14.5px/1.85/fg/text-wrap:pretty。
 * 写路径：编辑（inline textarea 保存/取消）、删除（确认由宿主执行）。
 */
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button, Icon } from "../../../../shared/primitives/index.js";
import type { ManuscriptBlockData } from "../store/ManuscriptStructureStore.js";
import styles from "./ManuscriptBlock.module.css";

export interface ManuscriptBlockProps {
  readonly block: ManuscriptBlockData;
  readonly onSelect?: () => void;
  readonly onOpenDraft?: (changeSetId: string) => void;
  /** 保存编辑（宿主带乐观锁 baseRevision 调用 store.updateParagraph） */
  readonly onSave?: (text: string) => Promise<void> | void;
  /** 删除段落（宿主确认后执行） */
  readonly onDelete?: () => void;
}

export function ManuscriptBlock({ block, onSelect, onSave, onDelete }: ManuscriptBlockProps) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(block.text);
  const [saving, setSaving] = useState(false);

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
        <div className={styles.head}>
          <span className={styles.id}>{block.blockId}</span>
          <span className={styles.digest}>编辑中</span>
        </div>
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
    <button
      type="button"
      className={styles.block}
      onClick={onSelect}
      data-block-id={block.blockId}
    >
      <div className={styles.head}>
        <span className={styles.id}>{block.blockId}</span>
        {block.isDraft === true ? <span className={styles.draft}>草稿</span> : null}
        <span className={styles.digest}>{block.digest}</span>
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
      </div>
      {block.text !== "" ? (
        <p className={styles.text}>{block.text}</p>
      ) : (
        <p className={styles.placeholder}>（正文加载中…）</p>
      )}
    </button>
  );
}
