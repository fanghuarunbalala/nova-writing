/**
 * ApprovalDock
 *
 * 审批挂接卡：渲染在聊天框（composer）上方、独立于消息流。琥珀主题浮卡：
 * 白底无边框 + 柔和投影；操作块 = 轻白胶囊 + 彩色文字（新增绿/编辑琥珀/删除红），
 * 每实体一条；等待审批 = 沙漏摇摆 + 琥珀渐变流动文字（下划线只在「等待审批」下）；
 * 底部统一琥珀图标（通过 ✓ / 驳回 ✕ / 审核详情 ↖）。点通过/驳回由上层 decide，
 * 卡片随投影审批决议而消失（不留结果记录）。
 */
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Hourglass, X } from "lucide-react";
import type { ToolApprovalProjection } from "@novel/core";
import type {
  ApprovalEntityResolver,
  ApprovalTarget,
} from "../../../domains/approval/approvalEntityResolver.js";
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
  /** 实体解析器（删除/编辑操作解析真实标题；缺省时回退显示 id）。 */
  readonly resolveEntity?: ApprovalEntityResolver;
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
  resolveEntity,
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
          resolveEntity={resolveEntity}
        />
      ))}
    </div>
  );
}

function ApprovalDockCard({
  group,
  onDecide,
  onOpenApproval,
  resolveEntity,
}: {
  readonly group: ApprovalGroup;
  readonly onDecide: ApprovalDockProps["onDecide"];
  readonly onOpenApproval: ApprovalDockProps["onOpenApproval"];
  readonly resolveEntity?: ApprovalDockProps["resolveEntity"];
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
              resolveEntity={resolveEntity}
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
  resolveEntity,
}: {
  readonly operation: ApprovalOperationRow;
  readonly resolveEntity?: ApprovalEntityResolver;
}) {
  const opLabel = OP_LABEL[operation.op] ?? operation.op;
  const kindLabel = KIND_LABEL[operation.kind] ?? operation.kind;
  const entity = useResolvedEntityName(operation, resolveEntity);
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

/**
 * 解析操作实体的显示标题：delete（及无真实标题的 edit）title===id，
 * 用 resolveEntity 取实体 name；解析完成前/失败回退到 id。
 */
function useResolvedEntityName(
  operation: ApprovalOperationRow,
  resolveEntity?: ApprovalEntityResolver,
): string | undefined {
  const hasRealTitle =
    operation.title !== undefined && operation.title !== operation.id;
  const [name, setName] = useState<string | undefined>(
    hasRealTitle ? operation.title : undefined,
  );
  useEffect(() => {
    if (hasRealTitle) {
      setName(operation.title);
      return;
    }
    if (resolveEntity === undefined || operation.id === undefined) {
      setName(operation.title);
      return;
    }
    let cancelled = false;
    const target: ApprovalTarget = {
      kind: operation.kind,
      id: operation.id,
      op: operation.op as ApprovalTarget["op"],
    };
    void resolveEntity(target)
      .then((content) => {
        if (!cancelled && content !== undefined && content.name.length > 0) {
          setName(content.name);
        }
      })
      .catch(() => {
        // 解析失败静默回退到 id。
      });
    return () => {
      cancelled = true;
    };
  }, [hasRealTitle, operation, resolveEntity]);
  return name ?? operation.title ?? operation.id;
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
