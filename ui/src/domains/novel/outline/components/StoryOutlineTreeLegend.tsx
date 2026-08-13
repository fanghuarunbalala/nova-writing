/**
 * StoryOutlineTreeLegend
 *
 * 大纲状态图例（原型 .tree-legend + .lg-key）。
 *
 * 8 项：3 个 plan-m（构思/大纲/就绪）+ 5 个 real-node（未开始/进行中/已完成/
 * 阻塞/搁置）。每项 lg-key pill：边框 + 999px 圆角 + surface 底。
 */
import styles from "./StoryOutlineTreeLegend.module.css";

type RealNodeState = "pending" | "in-progress" | "completed" | "blocked" | "abandoned";

interface LegendItem {
  readonly label: string;
  readonly kind: "plan" | "real";
  readonly planM?: 1 | 2 | 3;
  readonly realNode?: RealNodeState;
}

const ITEMS: readonly LegendItem[] = [
  { label: "构思", kind: "plan", planM: 1 },
  { label: "大纲", kind: "plan", planM: 2 },
  { label: "就绪", kind: "plan", planM: 3 },
  { label: "未开始", kind: "real", realNode: "pending" },
  { label: "进行中", kind: "real", realNode: "in-progress" },
  { label: "已完成", kind: "real", realNode: "completed" },
  { label: "阻塞", kind: "real", realNode: "blocked" },
  { label: "搁置", kind: "real", realNode: "abandoned" },
];

export function StoryOutlineTreeLegend() {
  return (
    <div className={styles.legend}>
      {ITEMS.map((item) => (
        <span key={item.label} className={styles.item}>
          {item.kind === "plan" ? (
            <PlanM value={item.planM!} />
          ) : (
            <RealNode state={item.realNode!} />
          )}
          <em className={styles.label}>{item.label}</em>
        </span>
      ))}
    </div>
  );
}

interface PlanMProps {
  readonly value: 1 | 2 | 3;
}

function PlanM({ value }: PlanMProps) {
  return (
    <span className={styles.planM} data-value={value} aria-hidden="true">
      <span className={styles.seg} />
      <span className={styles.seg} />
      <span className={styles.seg} />
    </span>
  );
}

interface RealNodeProps {
  readonly state: RealNodeState;
}

function RealNode({ state }: RealNodeProps) {
  return (
    <span
      className={`${styles.realNode} ${styles[`real-${state}`] ?? ""}`}
      aria-hidden="true"
    />
  );
}
