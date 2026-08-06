/**
 * ThinkLine
 *
 * 单行思考片段（原型 .tline）：6x6 dot mark + 文本 + 可选 tag。
 * 行间用 dashed border-top 分隔（首行无）。
 */
import type { ThinkLineData } from "../projection/ConversationTimelineItem.js";
import styles from "./ThinkLine.module.css";

export interface ThinkLineProps {
  readonly line: ThinkLineData;
}

export function ThinkLine({ line }: ThinkLineProps) {
  return (
    <div className={styles.line}>
      <span className={styles.mark} aria-hidden="true" />
      <p className={styles.text}>{line.text}</p>
      {line.tag !== undefined ? <span className={styles.tag}>{line.tag}</span> : null}
    </div>
  );
}
