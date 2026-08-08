/**
 * ApprovalCard
 *
 * 消息流审批卡（对齐原型最新版 .proposal）：每操作行 = op-chip 胶囊
 * （＋ 新增 / ～ 修改 / − 删除）+ 目标文本 + 英文 kind + 行内"查看"按钮；
 * 查看展开完整参数并滚动到对应工具的参数段。foot 保留整轮批准/请求修改
 * 与右侧审批状态。
 *
 * In-chat approval card: op-chip pill rows with per-row "查看" (reveal that
 * tool's full arguments), and footer-level approve / request-changes actions.
 */
import { useState } from "react";
import { Button } from "../../../shared/primitives/Button.js";
import type { ApprovalCardView } from "../projection/ConversationTimelineItem.js";
import styles from "./ApprovalCard.module.css";
import { DesignCard } from "./DesignCard.js";

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
  paragraph: "正文块",
  volume: "卷",
  chapter: "章节",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "待批准",
  approved: "已批准",
  rejected: "已拒绝",
  cancelled: "已取消",
  expired: "已过期",
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function operationText(operation: ApprovalCardView["operations"][number]): string {
  const kindLabel = KIND_LABEL[operation.kind] ?? operation.kind;
  const target = operation.title ?? operation.id;
  const idSuffix =
    operation.id !== undefined && operation.id !== operation.title
      ? ` · ${operation.id}`
      : "";
  return `${OP_LABEL[operation.op] ?? operation.op}${kindLabel}${
    target !== undefined ? ` ${target}` : ""
  }${idSuffix}`;
}

export interface ApprovalCardProps {
  readonly approval: ApprovalCardView;
  /** ExitComposeMode 审批：内嵌设计草稿卡。Embed the design draft for ExitComposeMode. */
  readonly designDraft?: { readonly conversationId: string };
  readonly onApprove?: (approvalRequestIds: readonly string[]) => void;
  readonly onReject?: (approvalRequestIds: readonly string[]) => void;
  /** 打开右侧审批面板并选中该组。Open the approval panel for this group. */
  readonly onOpenApproval?: (approvalRequestId: string) => void;
}

export function ApprovalCard({
  approval,
  designDraft,
  onApprove,
  onReject,
  onOpenApproval,
}: ApprovalCardProps) {
  const [showArguments, setShowArguments] = useState(false);
  const pending = approval.status === "pending";
  const operations = approval.operations;
  const argumentGroups = approval.argumentGroups.filter(
    (group) => group.arguments !== undefined,
  );
  const statusText =
    approval.status === "pending" && approval.approvalRequestIds.length > 1
      ? `待批准 ${approval.approvalRequestIds.length} 项`
      : STATUS_LABEL[approval.status] ?? approval.status;

  return (
    <section className={styles.card} data-status={approval.status}>
      <header className={styles.head}>
        <span
          className={[styles.tag, styles[approval.status]]
            .filter(Boolean)
            .join(" ")}
        >
          审批
        </span>
        <h4 className={styles.title}>{approval.title}</h4>
        <span className={styles.meta}>
          {approval.toolNames.join(" · ")} · {formatTime(approval.requestedAt)}
        </span>
      </header>
      {designDraft !== undefined ? (
        <DesignCard conversationId={designDraft.conversationId} phase="pending" />
      ) : null}
      {operations.length > 0 ? (
        <ul className={styles.ops}>
          {operations.map((operation, index) => (
            <li
              key={`${operation.toolName}-${operation.op}-${operation.id ?? operation.title ?? index}`}
              className={[styles.op, styles[operation.op]]
                .filter(Boolean)
                .join(" ")}
            >
              <span
                className={[styles.opChip, styles[operation.op]]
                  .filter(Boolean)
                  .join(" ")}
              >
                {OP_SYMBOL[operation.op] ?? "•"} {OP_LABEL[operation.op] ?? operation.op}
              </span>
              <span className={styles.opTxt} title={operationText(operation)}>
                {KIND_LABEL[operation.kind] !== undefined
                  ? KIND_LABEL[operation.kind]
                  : operation.kind}
                {operation.title !== undefined ? (
                  <>
                    {" "}
                    <b>{operation.title}</b>
                  </>
                ) : null}
                {operation.id !== undefined && operation.id !== operation.title
                  ? ` · ${operation.id}`
                  : ""}
              </span>
              <span className={styles.opKind}>{operation.kind}</span>
              <span className={styles.opAct}>
                <button
                  type="button"
                  className={styles.opView}
                  onClick={() => {
                    // 行内"查看"：打开右侧审批面板并选中本组（跳转定位）。
                    onOpenApproval?.(approval.approvalRequestIds[0]);
                  }}
                >
                  查看
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : approval.description !== undefined ? (
        <p className={styles.desc}>{approval.description}</p>
      ) : null}
      {argumentGroups.length > 0 ? (
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
            <div className={styles.argsBody}>
              {argumentGroups.map((group, index) => (
                <div
                  key={`${group.toolName}-${index}`}
                  className={styles.argsGroup}
                  data-tool={group.toolName}
                >
                  <span className={styles.argsTool}>{group.toolName}</span>
                  <pre className={styles.argsPre}>
                    {JSON.stringify(group.arguments, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <footer className={styles.foot}>
        {onOpenApproval !== undefined && approval.approvalRequestIds.length > 0 ? (
          <Button
            size="sm"
            variant="link"
            onClick={() => onOpenApproval(approval.approvalRequestIds[0])}
          >
            前往审批 →
          </Button>
        ) : null}
        {pending ? (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => onApprove?.(approval.approvalRequestIds)}
            >
              批准
            </Button>
            <Button
              size="sm"
              variant="ghost-danger"
              onClick={() => onReject?.(approval.approvalRequestIds)}
            >
              请求修改
            </Button>
          </>
        ) : null}
        <span
          className={[styles.status, styles[approval.status]]
            .filter(Boolean)
            .join(" ")}
        >
          {statusText}
        </span>
      </footer>
    </section>
  );
}
