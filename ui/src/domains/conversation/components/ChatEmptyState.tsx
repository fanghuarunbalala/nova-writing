/**
 * ChatEmptyState
 *
 * 无对话时的引导空态。
 */
import { Button } from "../../../shared/primitives/Button.js";
import styles from "./ChatEmptyState.module.css";

export interface ChatEmptyStateProps {
  readonly onCreate?: () => void;
}

export function ChatEmptyState({ onCreate }: ChatEmptyStateProps) {
  return (
    <div className={styles.empty}>
      <span className={styles.kicker}>开始创作</span>
      <h3>还没有对话</h3>
      <p>新建一个对话，和 Novel Agent 一起组织大纲、人物与正文。</p>
      {onCreate !== undefined ? (
        <Button variant="primary" onClick={onCreate}>
          新建对话
        </Button>
      ) : null}
    </div>
  );
}
