/**
 * WorkspaceFootingSection
 *
 * 侧栏底部 workspace 入口。
 */
import { WorkspaceFooting } from "../../../domains/workspace/components/WorkspaceFooting.js";

export interface WorkspaceFootingSectionProps {
  readonly workspaceId?: string;
  readonly label?: string;
  readonly meta: string;
  readonly onClick?: () => void;
}

export function WorkspaceFootingSection({
  workspaceId,
  label,
  meta,
  onClick,
}: WorkspaceFootingSectionProps) {
  if (workspaceId === undefined || label === undefined) return null;
  return (
    <div style={{ marginTop: "auto", padding: "8px 10px" }}>
      <WorkspaceFooting workspaceId={workspaceId} label={label} meta={meta} onClick={onClick} />
    </div>
  );
}
