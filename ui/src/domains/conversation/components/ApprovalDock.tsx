/**
 * ApprovalDock
 *
 * 审批挂接卡：渲染在聊天框（composer）上方、独立于消息流。琥珀主题浮卡：
 * 白底无边框 + 柔和投影；操作块 = 轻白胶囊 + 彩色文字（新增绿/编辑琥珀/删除红），
 * 每实体一条；等待审批 = 沙漏摇摆 + 琥珀渐变流动文字（下划线只在「等待审批」下）；
 * 底部统一琥珀图标（通过 ✓ / 驳回 ✕ / 审核详情 ↖）。点通过/驳回由上层 decide，
 * 卡片随投影审批决议而消失（不留结果记录）。
 */
import { ArrowUpRight, Check, Hourglass, X } from "lucide-react";
import type { ToolApprovalProjection } from "@novel/core";
import { Icon } from "../../../shared/primitives/Icon.js";
import styles from "./ApprovalDock.module.css";

const OP_LABEL: Record<string, string> = {
  add: "新增",
  edit: "编辑",
  delete: "删除",
};

const KIND_LABEL: Record<string, string> = {
  outline: "大纲",
  character: "角色",
  location: "地点",
  paragraph: "正文块",
  volume: "卷",
  chapter: "章节",
};

export interface ApprovalDockProps {
  /** 本会话待审批的审批（status=pending）。 */
  readonly approvals: readonly ToolApprovalProjection[];
  readonly onDecide: (
    approvalRequestIds: readonly string[],
    decision: "approved" | "rejected",
  ) => void;
  readonly onOpenApproval: (approvalRequestId: string) => void;
}

interface ApprovalGroup {
  readonly key: string;
  readonly approvals: readonly ToolApprovalProjection[];
}

interface ApprovalOperationRow {
  readonly op: string;
  readonly kind: string;
  readonly id?: string;
  readonly title?: string;
  readonly toolName: string;
}

export function ApprovalDock({
  approvals,
  onDecide,
  onOpenApproval,
}: ApprovalDockProps) {
  if (approvals.length === 0) return null;
  const groups = groupPending(approvals);
  return (
    <div className={styles.dock}>
      {groups.map((group) => (
        <ApprovalDockCard
          key={group.key}
          group={group}
          onDecide={onDecide}
          onOpenApproval={onOpenApproval}
        />
      ))}
    </div>
  );
}

function ApprovalDockCard({
  group,
  onDecide,
  onOpenApproval,
}: {
  readonly group: ApprovalGroup;
  readonly onDecide: ApprovalDockProps["onDecide"];
  readonly onOpenApproval: ApprovalDockProps["onOpenApproval"];
}) {
  const requestIds = group.approvals.map(
    (approval) => approval.approvalRequestId,
  );
  const operations: ApprovalOperationRow[] = group.approvals.flatMap(
    (approval) =>
      (approval.operations ?? []).map((operation) => ({
        op: operation.op,
        kind: operation.kind,
        ...(operation.id === undefined ? {} : { id: operation.id }),
        ...(operation.title === undefined ? {} : { title: operation.title }),
        toolName: approval.toolName,
      })),
  );
  const first = group.approvals[0];
  return (
    <div className={styles.card}>
      {operations.length > 0 ? (
        <div className={styles.ops}>
          {operations.map((operation, index) => (
            <OpChip
              key={`${operation.toolName}-${operation.id ?? operation.title ?? index}`}
              operation={operation}
            />
          ))}
        </div>
      ) : null}
      <div className={styles.waitRow}>
        <span className={styles.hourglass}>
          <Icon icon={Hourglass} size="sm" />
        </span>
        <span className={styles.waitingLabel}>等待审批</span>
        <span className={styles.icons}>
          {first !== undefined ? (
            <button
              type="button"
              className={styles.jump}
              title="审核详情"
              onClick={() => onOpenApproval(first.approvalRequestId)}
            >
              <Icon icon={ArrowUpRight} size="sm" />
              <span className={styles.jumpText}>审核详情</span>
            </button>
          ) : null}
          <button
            type="button"
            className={styles.iconBtn}
            title="驳回"
            onClick={() => onDecide(requestIds, "rejected")}
          >
            <Icon icon={X} size="md" strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            title="通过"
            onClick={() => onDecide(requestIds, "approved")}
          >
            <Icon icon={Check} size="md" strokeWidth={2} />
          </button>
        </span>
      </div>
    </div>
  );
}

function OpChip({
  operation,
}: {
  readonly operation: ApprovalOperationRow;
}) {
  const opLabel = OP_LABEL[operation.op] ?? operation.op;
  const kindLabel = KIND_LABEL[operation.kind] ?? operation.kind;
  const entity = operation.title ?? operation.id;
  return (
    <span className={[styles.op, styles[operation.op]].filter(Boolean).join(" ")}>
      {opLabel}
      {kindLabel}
      {entity !== undefined ? (
        <>
          ：<b>{entity}</b>
        </>
      ) : null}
    </span>
  );
}

/** 按 turn 分组待审批项（无 turnId 时各自成组）。 */
function groupPending(
  approvals: readonly ToolApprovalProjection[],
): ApprovalGroup[] {
  const byKey = new Map<string, ToolApprovalProjection[]>();
  for (const approval of approvals) {
    const key = approval.turnId ?? `req-${approval.approvalRequestId}`;
    const list = byKey.get(key) ?? [];
    list.push(approval);
    byKey.set(key, list);
  }
  return [...byKey.entries()].map(([key, list]) => ({
    key,
    approvals: Object.freeze(list),
  }));
}
