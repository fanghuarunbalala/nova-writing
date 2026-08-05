/**
 * StoryOutlineTreeStatus
 *
 * 节点状态：plan-m 三段进度条 + real-node 圆点。
 */
import styles from "./StoryOutlineTreeStatus.module.css";

export interface StoryOutlineTreeStatusProps {
  readonly planM: 1 | 2 | 3;
  readonly realNode: "pending" | "in-progress" | "completed" | "blocked" | "abandoned";
}

export function StoryOutlineTreeStatus({ planM, realNode }: StoryOutlineTreeStatusProps) {
  return (
    <span className={styles.status} title={realNode}>
      <span className={styles.bar} aria-hidden="true">
        <span className={planM >= 1 ? styles.on : ""} />
        <span className={planM >= 2 ? styles.on : ""} />
        <span className={planM >= 3 ? styles.on : ""} />
      </span>
      <span className={[styles.dot, styles[realNode]].filter(Boolean).join(" ")} aria-hidden="true" />
    </span>
  );
}
