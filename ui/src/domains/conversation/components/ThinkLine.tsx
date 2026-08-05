/**
 * ThinkLine
 *
 * 单行思考片段：文本 + 可选 tag。
 */
import type { ThinkLineData } from "../projection/ConversationTimelineItem.js";
import styles from "./ThinkLine.module.css";

export interface ThinkLineProps {
  readonly line: ThinkLineData;
}

export function ThinkLine({ line }: ThinkLineProps) {
  return (
    <div className={styles.line}>
      {line.tag !== undefined ? <span className={styles.tag}>{line.tag}</span> : null}
      <span className={styles.text}>{line.text}</span>
    </div>
  );
}
