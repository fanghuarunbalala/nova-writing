/**
 * ScheduleAxisFlow
 *
 * 双轴流程：计划轴（idea/outlined/ready）与实现轴（pending…abandoned）。
 */
import styles from "./ScheduleAxisFlow.module.css";

export interface ScheduleAxisFlowProps {
  readonly planAxis: readonly string[];
  readonly realAxis: readonly string[];
}

export function ScheduleAxisFlow({ planAxis, realAxis }: ScheduleAxisFlowProps) {
  return (
    <div className={styles.flow}>
      <div className={styles.axis}>
        <span className={styles.kicker}>计划</span>
        {planAxis.map((step) => (
          <span key={step} className={styles.step}>
            {step}
          </span>
        ))}
      </div>
      <div className={styles.axis}>
        <span className={styles.kicker}>实现</span>
        {realAxis.map((step) => (
          <span key={step} className={styles.step}>
            {step}
          </span>
        ))}
      </div>
    </div>
  );
}
