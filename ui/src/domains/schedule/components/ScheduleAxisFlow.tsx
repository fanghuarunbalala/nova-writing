/**
 * ScheduleAxisFlow
 *
 * 双状态轴卡片（原型 .axis-card）：标题 + 描述 + 单行流程线。
 * 流程线把「规划轴」与「实现轴」串成一条，用 arr（->）连接，
 * idea/ready/abandoned 用 chip-old/chip-new/lg.real-abandoned 着色。
 */
import styles from "./ScheduleAxisFlow.module.css";

export interface ScheduleAxisFlowProps {
  readonly planAxis: readonly string[];
  readonly realAxis: readonly string[];
}

const PLAN_LABEL: Record<string, string> = { idea: "规划轴" };
const REAL_LABEL: Record<string, string> = { pending: "实现轴" };

const CHIP_CLASS: Record<string, string> = {
  idea: styles.chipOld,
  ready: styles.chipNew,
  abandoned: styles.lgAbandoned,
};

export function ScheduleAxisFlow({ planAxis, realAxis }: ScheduleAxisFlowProps) {
  return (
    <section className={styles.card}>
      <h3 className={styles.title}>双状态轴</h3>
      <p className={styles.desc}>
        规划成熟度（idea -&gt; outlined -&gt; ready）与正文实现（pending -&gt; in-progress -&gt; completed /
        abandoned）是两条独立状态轴，阻塞与搁置都保留原因和替换痕迹。
      </p>
      <div className={styles.flow}>
        {planAxis.map((step, index) => (
          <FlowItem key={`plan-${step}`} step={step} label={PLAN_LABEL[step]} first={index === 0} />
        ))}
        <span className={styles.sep} />
        {realAxis.map((step, index) => (
          <FlowItem
            key={`real-${step}`}
            step={step}
            label={REAL_LABEL[step]}
            sep={index === realAxis.length - 2 ? "/" : "->"}
          />
        ))}
      </div>
    </section>
  );
}

interface FlowItemProps {
  readonly step: string;
  readonly label?: string;
  readonly first?: boolean;
  readonly sep?: string;
}

function FlowItem({ step, label, first = false, sep = "->" }: FlowItemProps) {
  const chipClass = CHIP_CLASS[step];
  return (
    <>
      {label !== undefined ? <span className={styles.axisLabel}>{label}</span> : null}
      {!first ? <span className={styles.arr}>{sep}</span> : null}
      <b className={chipClass ?? styles.chip}>{step}</b>
    </>
  );
}
