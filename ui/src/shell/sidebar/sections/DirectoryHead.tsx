/**
 * DirectoryHead
 *
 * 目录标题行（原型 .dirHead）：标签 + 计数 pill + 右侧工具位（如展开/折叠图标按钮）。
 */
import type { ReactNode } from "react";
import styles from "./directory.module.css";

export interface DirectoryHeadProps {
  readonly label: string;
  readonly count?: number;
  /** 右侧工具（大纲 pane = 展开/折叠图标按钮） */
  readonly tools?: ReactNode;
}

export function DirectoryHead({ label, count, tools }: DirectoryHeadProps) {
  return (
    <div className={styles.dirHead}>
      {label}
      {count !== undefined ? <span className={styles.cnt}>{count}</span> : null}
      {tools !== undefined ? <span className={styles.dirTools}>{tools}</span> : null}
    </div>
  );
}
