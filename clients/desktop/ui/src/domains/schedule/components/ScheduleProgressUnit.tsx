/**
 * ScheduleProgressUnit
 *
 * 进度树单行（原型 .unit + .u-status + .plan-m + .real-node + .u-prog）。
 *
 * 行内：label 在左，u-status 在右（margin-left:auto）。u-status 包含
 * plan-m 三格成熟度条 + real-node 状态节点 + 可选 u-prog 数字。
 * 阻塞/废弃原因作为兄弟 .block-note / .abandoned-note 渲染，缩进对齐父单元。
 */
import type { ScheduleProgressUnitData } from "../projection/ScheduleProjection.js";
import { ScheduleAbandonedNote } from "./ScheduleAbandonedNote.js";
import styles from "./ScheduleProgressUnit.module.css";

export interface ScheduleProgressUnitProps {
  readonly unit: ScheduleProgressUnitData;
}

export function ScheduleProgressUnit({ unit }: ScheduleProgressUnitProps) {
  return (
    <>
      <div className={styles.unit} data-depth={unit.depth}>
        <span className={styles.label}>{unit.label}</span>
        <span className={styles.uStatus}>
          <PlanMature value={unit.planM} />
          <RealNode state={unit.realNode} />
          {unit.progress !== undefined ? (
            <span className={styles.uProg}>
              {unit.progress.completed}/{unit.progress.total}
            </span>
          ) : null}
        </span>
      </div>
      {unit.blockedReason !== undefined ? (
        <ScheduleAbandonedNote kind="blocked" reason={unit.blockedReason} depth={unit.depth} />
      ) : null}
      {unit.abandonedReason !== undefined ? (
        <ScheduleAbandonedNote kind="abandoned" reason={unit.abandonedReason} depth={unit.depth} />
      ) : null}
    </>
  );
}

interface PlanMatureProps {
  readonly value: 1 | 2 | 3;
}

function PlanMature({ value }: PlanMatureProps) {
  return (
    <span
      className={styles.planM}
      data-value={value}
      title={`规划：${value === 1 ? "构思" : value === 2 ? "大纲" : "就绪"}`}
      aria-hidden="true"
    >
      <span className={styles.seg} />
      <span className={styles.seg} />
      <span className={styles.seg} />
    </span>
  );
}

interface RealNodeProps {
  readonly state: ScheduleProgressUnitData["realNode"];
}

function RealNode({ state }: RealNodeProps) {
  const titleMap: Record<typeof state, string> = {
    pending: "实现：未开始",
    "in-progress": "实现：进行中",
    completed: "实现：已完成",
    blocked: "阻塞",
    abandoned: "已搁置",
  };
  return <span className={`${styles.realNode} ${styles[`real-${state}`] ?? ""}`} title={titleMap[state]} aria-hidden="true" />;
}
