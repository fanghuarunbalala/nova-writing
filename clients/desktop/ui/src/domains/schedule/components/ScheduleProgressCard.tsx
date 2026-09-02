/**
 * ScheduleProgressCard
 *
 * 进度卡片：标题 + 进度树。
 */
import type { ReactNode } from "react";
import styles from "./ScheduleProgressCard.module.css";

export interface ScheduleProgressCardProps {
  readonly title: string;
  readonly children: ReactNode;
}

export function ScheduleProgressCard({ title, children }: ScheduleProgressCardProps) {
  return (
    <section className={styles.card}>
      <h4 className={styles.title}>{title}</h4>
      {children}
    </section>
  );
}
