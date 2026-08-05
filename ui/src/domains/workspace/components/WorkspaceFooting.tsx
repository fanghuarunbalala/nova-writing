/**
 * WorkspaceFooting
 *
 * 侧栏底部 workspace 入口：label + meta（修订号/最后提交时间），点击可打开选择器。
 */
import styles from "./WorkspaceFooting.module.css";

export interface WorkspaceFootingProps {
  readonly workspaceId: string;
  readonly label: string;
  readonly meta: string; // "r041 · 最后提交 14:02"
  readonly onClick?: () => void;
}

export function WorkspaceFooting({ workspaceId, label, meta, onClick }: WorkspaceFootingProps) {
  return (
    <button type="button" className={styles.footing} onClick={onClick} title={workspaceId}>
      <span className={styles.label}>{label}</span>
      <span className={styles.meta}>{meta}</span>
    </button>
  );
}
