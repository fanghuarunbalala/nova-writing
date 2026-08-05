/**
 * WorkspaceFootingSection
 *
 * 侧栏底部 workspace 入口。margin-top: auto 把 footing 推到侧栏最底；
 * padding/border-top 由 WorkspaceFooting 自身承担（对齐原型 .side-foot）。
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
    <div style={{ marginTop: "auto" }}>
      <WorkspaceFooting workspaceId={workspaceId} label={label} meta={meta} onClick={onClick} />
    </div>
  );
}
