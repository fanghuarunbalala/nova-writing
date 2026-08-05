/**
 * StoryOutlineTreeLegend
 *
 * 大纲状态图例。
 */
import { StoryOutlineTreeStatus } from "./StoryOutlineTreeStatus.js";
import styles from "./StoryOutlineTreeLegend.module.css";

type StoryOutlineTreeLegendItem = "pending" | "in-progress" | "completed" | "blocked" | "abandoned";

const LEGEND: ReadonlyArray<{ readonly label: string; readonly planM: 1 | 2 | 3; readonly realNode: StoryOutlineTreeLegendItem }> = [
  { label: "进行中", planM: 2, realNode: "in-progress" },
  { label: "已完成", planM: 3, realNode: "completed" },
  { label: "阻塞", planM: 1, realNode: "blocked" },
  { label: "已废弃", planM: 1, realNode: "abandoned" },
];

export function StoryOutlineTreeLegend() {
  return (
    <div className={styles.legend}>
      {LEGEND.map((item) => (
        <span key={item.label} className={styles.item}>
          <StoryOutlineTreeStatus planM={item.planM} realNode={item.realNode} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
