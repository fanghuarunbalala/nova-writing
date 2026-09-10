/**
 * ManuscriptBlock
 *
 * 正文段（MS-3：衬线 16.5px / 行高 1.95 / 首行缩进 2em / 两端对齐）。
 * 段内实体引用标签（<character id="…">…</character> 等）渲染为可点 chip
 * （点击路由与对话流一致：内容视图直跳对应档案/单元）。
 * 草稿段（MS-4）：warn 3px 左线 + 6% 底色 + 尾标「草稿 · 未转入正式稿」。
 * 写路径：hover 高亮段落背景 + 浮现右上角编辑/删除工具组（突出可点）。
 */
import { useState } from "react";
import { Feather, Pencil, Trash2 } from "lucide-react";
import { Button, Icon } from "../../../../shared/primitives/index.js";
import type { ManuscriptBlockData } from "../store/ManuscriptStructureStore.js";
import { MessageReferenceChip, type MessageReference } from "../../../conversation/components/MessageReference.js";
import type { ReferenceResolver } from "../../../conversation/reference/ReferenceResolver.js";
import { parseReferenceSpans } from "../../../conversation/components/assistantContent/extractReferenceTags.js";
import styles from "./ManuscriptBlock.module.css";

export interface ManuscriptBlockProps {
  readonly block: ManuscriptBlockData;
  /** 实体引用 chip 点击（宿主路由：内容视图直跳档案/单元） */
  readonly onReferenceClick?: (reference: MessageReference) => void;
  /** 引用解析（chip 显示名 / missing 态） */
  readonly resolveReference?: ReferenceResolver;
  /** 保存编辑（宿主带乐观锁 baseRevision 调用 store.updateParagraph） */
  readonly onSave?: (text: string) => Promise<void> | void;
  /** 删除段落（宿主确认后执行） */
  readonly onDelete?: () => void;
}

export function ManuscriptBlock({
  block,
  onReferenceClick,
  resolveReference,
  onSave,
  onDelete,
}: ManuscriptBlockProps) {
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

  const spans = parseReferenceSpans(block.text);
  const hasRefs = spans.some((span) => span.type === "ref");

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
              编辑
            </button>
          ) : null}
          {onDelete !== undefined ? (
            <button
              type="button"
              className={[styles.actionButton, styles.danger].filter(Boolean).join(" ")}
              aria-label="删除段落"
              title="删除段落"
              onClick={onDelete}
            >
              <Icon icon={Trash2} size="xs" />
              删除
            </button>
          ) : null}
        </span>
      ) : null}
      {block.text !== "" ? (
        <p className={styles.text}>
          {hasRefs
            ? spans.map((span, index) =>
                span.type === "text" ? (
                  <span key={index}>{span.text}</span>
                ) : (
                  <MessageReferenceChip
                    key={index}
                    reference={{
                      refKind: span.refKind,
                      id: span.id,
                      ...(span.label !== "" ? { label: span.label } : {}),
                    }}
                    onClick={onReferenceClick}
                    resolved={resolveReference?.({
                      refKind: span.refKind,
                      id: span.id,
                      ...(span.label !== "" ? { label: span.label } : {}),
                    })}
                  />
                ),
              )
            : block.text}
        </p>
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
