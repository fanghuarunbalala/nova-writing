/**
 * WorkspaceLabel
 *
 * 顶栏 workspace 标识；collapsed 时只显示首字符。
 */
import styles from "./WorkspaceLabel.module.css";

export interface WorkspaceLabelProps {
  readonly label: string;
  readonly collapsed?: boolean;
  readonly onClick?: () => void;
}

export function WorkspaceLabel({ label, collapsed = false, onClick }: WorkspaceLabelProps) {
  return (
    <button type="button" className={styles.label} onClick={onClick} title={label}>
      {collapsed ? label.slice(0, 1) : label}
    </button>
  );
}
