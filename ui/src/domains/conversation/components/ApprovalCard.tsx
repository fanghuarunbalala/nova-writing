/**
 * ApprovalCard
 *
 * 消息流审批卡（对齐原型 .proposal：tag + head + ops + foot）：
 * 每目标一行操作摘要，可展开查看完整参数；pending 时可批准/请求修改。
 *
 * In-chat approval card: per-target operation rows, expandable full arguments,
 * approve / request-changes actions while pending.
 */
import { useState } from "react";
import { Button } from "../../../shared/primitives/Button.js";
import { Pill } from "../../../shared/primitives/Pill.js";
import type { ApprovalCardView } from "../projection/ConversationTimelineItem.js";
import styles from "./ApprovalCard.module.css";

const OP_SYMBOL: Record<string, string> = {
  add: "+",
  edit: "~",
  delete: "−",
};

const OP_LABEL: Record<string, string> = {
  add: "新增",
  edit: "修改",
  delete: "删除",
};

const KIND_LABEL: Record<string, string> = {
  outline: "大纲单元",
  character: "角色",
  location: "地点",
  paragraph: "段落",
  volume: "卷",
  chapter: "章节",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已拒绝",
  cancelled: "已取消",
  expired: "已过期",
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function opClass(op: string): string {
  if (op === "add") return styles.add;
  if (op === "edit") return styles.mod;
  if (op === "delete") return styles.del;
  return "";
}

export interface ApprovalCardProps {
  readonly approval: ApprovalCardView;
  readonly onApprove?: (approvalRequestId: string) => void;
  readonly onReject?: (approvalRequestId: string) => void;
}

export function ApprovalCard({
  approval,
  onApprove,
  onReject,
}: ApprovalCardProps) {
  const [showArguments, setShowArguments] = useState(false);
  const pending = approval.status === "pending";
  const operations = approval.operations ?? [];
  const serializedArguments =
    approval.arguments === undefined
      ? undefined
      : JSON.stringify(approval.arguments, null, 2);
  return (
    <section className={styles.card} data-status={approval.status}>
      <header className={styles.head}>
        <Pill
          variant={
            approval.status === "pending"
              ? "pending"
              : approval.status === "approved"
                ? "approved"
                : "info"
          }
        >
          {STATUS_LABEL[approval.status] ?? approval.status}
        </Pill>
        <h4 className={styles.title}>{approval.title}</h4>
        <span className={styles.meta}>{formatTime(approval.requestedAt)}</span>
      </header>
      {operations.length > 0 ? (
        <ul className={styles.ops}>
          {operations.map((operation, index) => (
            <li
              key={`${operation.op}-${operation.id ?? operation.title ?? index}`}
              className={[styles.op, opClass(operation.op)].filter(Boolean).join(" ")}
            >
              <span className={styles.opMark} aria-hidden="true">
                {OP_SYMBOL[operation.op] ?? "•"}
              </span>
              <span className={styles.opText}>
                {OP_LABEL[operation.op] ?? operation.op}
                {KIND_LABEL[operation.kind] !== undefined
                  ? KIND_LABEL[operation.kind]
                  : ` ${operation.kind}`}
                {operation.title !== undefined ? `：${operation.title}` : ""}
                {operation.id !== undefined && operation.id !== operation.title
                  ? `（${operation.id}）`
                  : ""}
              </span>
              <span className={styles.opKind}>
                {KIND_LABEL[operation.kind] ?? operation.kind}
              </span>
            </li>
          ))}
        </ul>
      ) : approval.description !== undefined ? (
        <p className={styles.desc}>{approval.description}</p>
      ) : null}
      {serializedArguments !== undefined ? (
        <div className={styles.args}>
          <button
            type="button"
            className={styles.argsToggle}
            onClick={() => setShowArguments((value) => !value)}
            aria-expanded={showArguments}
          >
            {showArguments ? "收起完整参数" : "查看完整参数"}
          </button>
          {showArguments ? (
            <pre className={styles.argsBody}>{serializedArguments}</pre>
          ) : null}
        </div>
      ) : null}
      {pending ? (
        <footer className={styles.foot}>
          <Button
            size="sm"
            variant="primary"
            onClick={() => onApprove?.(approval.approvalRequestId)}
          >
            批准
          </Button>
          <Button
            size="sm"
            variant="ghost-danger"
            onClick={() => onReject?.(approval.approvalRequestId)}
          >
            请求修改
          </Button>
        </footer>
      ) : null}
    </section>
  );
}
