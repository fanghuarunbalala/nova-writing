/**
 * SidebarSection
 *
 * 通用侧栏 section：label + count-pill + children。
 */
import type { ReactNode } from "react";
import styles from "./SidebarSection.module.css";

export interface SidebarSectionProps {
  readonly label: string;
  readonly count?: number;
  readonly children: ReactNode;
}

export function SidebarSection({ label, count, children }: SidebarSectionProps) {
  return (
    <section className={styles.section}>
      <header className={styles.head}>
        <span className={styles.label}>{label}</span>
        {count !== undefined && count > 0 ? <span className={styles.count}>{count}</span> : null}
      </header>
      {children}
    </section>
  );
}
