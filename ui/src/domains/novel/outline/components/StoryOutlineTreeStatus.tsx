/**
 * StoryOutlineTreeStatus
 *
 * 节点状态（原型 .u-status + .plan-m + .real-node）。
 *
 * plan-m 三格成熟度条（5x3px segments，pm-1 muted/pm-2 info/pm-3 success），
 * real-node 形状+色彩+透明度状态节点（9x9 圆，blocked 8x8 旋转方）。
 */
import styles from "./StoryOutlineTreeStatus.module.css";

export interface StoryOutlineTreeStatusProps {
  readonly planM: 1 | 2 | 3;
  readonly realNode: "pending" | "in-progress" | "completed" | "blocked" | "abandoned";
}

const REAL_TITLE: Record<StoryOutlineTreeStatusProps["realNode"], string> = {
  pending: "实现：未开始",
  "in-progress": "实现：进行中",
  completed: "实现：已完成",
  blocked: "阻塞",
  abandoned: "已搁置",
};

export function StoryOutlineTreeStatus({ planM, realNode }: StoryOutlineTreeStatusProps) {
  return (
    <span className={styles.status} title={realNode}>
      <span className={styles.planM} data-value={planM} aria-hidden="true">
        <span className={styles.seg} />
        <span className={styles.seg} />
        <span className={styles.seg} />
      </span>
      <span
        className={`${styles.realNode} ${styles[`real-${realNode}`] ?? ""}`}
        title={REAL_TITLE[realNode]}
        aria-hidden="true"
      />
    </span>
  );
}
