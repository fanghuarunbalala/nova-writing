/**
 * MessageReference
 *
 * 消息内联实体引用（原型 .xr）：character/location/outline/chapter/paragraph。
 * 成对写法自带 label；自闭合（<kind id="x"/>）无 label 时由 resolved 解析档案名。
 * resolved.known=false 时显示虚线下划线（missing 态），点击提示未建档。
 */
import styles from "./MessageReference.module.css";

export interface MessageReference {
  readonly refKind: "character" | "location" | "outline" | "chapter" | "paragraph";
  readonly id: string;
  /** 显式标签（成对写法的内文或 name 覆盖）；自闭合且无 name 时缺省。 */
  readonly label?: string;
}

export interface ResolvedReference {
  readonly label: string;
  readonly known: boolean;
}

export interface MessageReferenceProps {
  readonly reference: MessageReference;
  readonly onClick?: (reference: MessageReference) => void;
  readonly resolved?: ResolvedReference;
}

export function MessageReferenceChip({
  reference,
  onClick,
  resolved,
}: MessageReferenceProps) {
  const display = reference.label ?? resolved?.label ?? reference.id;
  const known = resolved?.known ?? true;
  return (
    <button
      type="button"
      className={[styles.chip, known ? "" : styles.missing].filter(Boolean).join(" ")}
      onClick={() => onClick?.(reference)}
      title={known ? undefined : `暂未建立「${display}」的档案`}
    >
      {display}
    </button>
  );
}
