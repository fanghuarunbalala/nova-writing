/** Safe Tool Approval summary projected from durable Events. */
import type { ToolApprovalProjection } from "@novel/core";
import { TimelineTimestamp } from "./TimelineTimestamp.js";

const STATUS_LABELS: Readonly<Record<ToolApprovalProjection["status"], string>> = {
  pending: "等待确认",
  approved: "已允许",
  rejected: "已拒绝",
  expired: "已过期",
  cancelled: "已取消",
};

export function ToolApprovalItem({ approval }: { readonly approval: ToolApprovalProjection }) {
  return (
    <article className="novel-approval-card" data-approval-status={approval.status}>
      <header className="novel-card-header">
        <span>操作确认</span>
        <TimelineTimestamp timestamp={approval.requestedAt} />
      </header>
      <h3>{approval.title}</h3>
      {approval.description !== undefined ? <p>{approval.description}</p> : null}
      <div className="novel-card-status">{STATUS_LABELS[approval.status]}</div>
    </article>
  );
}
