/**
 * TopBarWorkspaceLabel
 *
 * 顶栏 workspace 标识（复用 workspace 域组件）。
 */
import { WorkspaceLabel } from "../../domains/workspace/components/WorkspaceLabel.js";

export interface TopBarWorkspaceLabelProps {
  readonly label: string;
  readonly onClick?: () => void;
}

export function TopBarWorkspaceLabel({ label, onClick }: TopBarWorkspaceLabelProps) {
  return <WorkspaceLabel label={label} onClick={onClick} />;
}
