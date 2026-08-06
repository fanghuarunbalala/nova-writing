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
      <h3>新对话</h3>
      <p>描述你想推进的创作任务：起草场景、修订正文、推进大纲节点。Novel Agent 会直接生成草稿与提议，供你审批。</p>
      {onCreate !== undefined ? (
        <Button variant="primary" onClick={onCreate}>
          新建对话
        </Button>
      ) : null}
    </div>
  );
}
