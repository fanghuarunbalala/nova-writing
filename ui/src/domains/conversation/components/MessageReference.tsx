/**
 * MessageReference
 *
 * 消息内联实体引用 chip（角色/地点/大纲）。
 */
import styles from "./MessageReference.module.css";

export interface MessageReference {
  readonly refKind: "character" | "location" | "outline";
  readonly id: string;
  readonly label: string;
}

export interface MessageReferenceProps {
  readonly reference: MessageReference;
  readonly onClick?: (reference: MessageReference) => void;
}

export function MessageReferenceChip({ reference, onClick }: MessageReferenceProps) {
  return (
    <button
      type="button"
      className={styles.chip}
      onClick={() => onClick?.(reference)}
      title={reference.label}
    >
      {reference.label}
    </button>
  );
}
