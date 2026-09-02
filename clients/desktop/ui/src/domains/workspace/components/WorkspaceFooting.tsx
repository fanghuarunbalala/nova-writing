/**
 * WorkspaceFooting
 *
 * 侧栏底部 workspace 入口（对齐原型 .side-foot）：ws-mark 头像（label 首字）
 * + label + meta（修订号/最后提交时间），点击可打开选择器。
 */
import styles from "./WorkspaceFooting.module.css";

export interface WorkspaceFootingProps {
  readonly workspaceId: string;
  readonly label: string;
  readonly meta: string; // "r041 · 最后提交 14:02"
  readonly onClick?: () => void;
}

export function WorkspaceFooting({ workspaceId, label, meta, onClick }: WorkspaceFootingProps) {
  const mark = label.trim().charAt(0) || "?";
  return (
    <button type="button" className={styles.footing} onClick={onClick} title={workspaceId}>
      <span className={styles.mark} aria-hidden="true">{mark}</span>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        <span className={styles.meta}>{meta}</span>
      </span>
    </button>
  );
}
