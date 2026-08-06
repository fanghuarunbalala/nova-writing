/**
 * UserMessage
 *
 * 用户消息：头像 + 文本（内联引用标记渲染为 chip）。
 */
import { Avatar } from "../../../shared/primitives/Avatar.js";
import { parseMessageText } from "./parseMessageText.js";
import type { MessageReference, ResolvedReference } from "./MessageReference.js";
import styles from "./UserMessage.module.css";

export interface UserMessageProps {
  readonly sequence: number;
  readonly text: string;
  readonly timestamp: number;
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: (reference: MessageReference) => ResolvedReference | undefined;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function UserMessage({
  sequence,
  text,
  timestamp,
  onReferenceClick,
  resolveReference,
}: UserMessageProps) {
  return (
    <div className={styles.message} data-sequence={sequence}>
      <Avatar variant="user" text="我" size="md" />
      <div className={styles.body}>
        <div className={styles.head}>
          <span className={styles.who}>你</span>
          <time className={styles.time}>{formatTime(timestamp)}</time>
        </div>
        <div className={styles.text}>
          {parseMessageText(text, onReferenceClick, resolveReference)}
        </div>
      </div>
    </div>
  );
}
