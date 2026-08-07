/**
 * ApprovalPanel
 *
 * 审批面板（原型 .insp-list + .appr-scroll + .identity + .detail-foot）：
 * 上为待审/已决列表，下为选中审批的详情（工具名、操作摘要、digest、状态）
 * 与操作（批准 / 拒绝；已决显示 resolved banner）。
 *
 * Approval panel: request list on top, selected request detail below with
 * approve/reject actions (or a resolved banner).
 */
import { useMemo } from "react";
import { Button } from "../../../shared/primitives/Button.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { ApprovalStore, ApprovalView } from "../ApprovalStore.js";
import styles from "./ApprovalPanel.module.css";

export interface ApprovalPanelProps {
  readonly store: ApprovalStore;
}

const STATUS_LABEL: Record<ApprovalView["status"], string> = {
  pending: "待批准",
  approved: "已批准",
  rejected: "已拒绝",
  cancelled: "已取消",
  expired: "已过期",
};

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

function opClass(op: string): string {
  if (op === "add") return styles.add;
  if (op === "edit") return styles.mod;
  if (op === "delete") return styles.del;
  return "";
}

function shortDigest(digest: string): string {
  return digest.length > 16 ? `${digest.slice(0, 8)}…${digest.slice(-4)}` : digest;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ApprovalPanel({ store }: ApprovalPanelProps) {
  const snapshot = useExternalStore(store);
  const selected =
    snapshot.approvals.find(
      (approval) => approval.approvalRequestId === snapshot.selectedId,
    ) ??
    snapshot.approvals.find((approval) => approval.status === "pending") ??
    snapshot.approvals[0];

  const sorted = useMemo(
    () =>
      [...snapshot.approvals].sort((left, right) =>
        left.requestedAt.localeCompare(right.requestedAt),
      ),
    [snapshot.approvals],
  );

  return (
    <div className={styles.panel}>
      <nav className={styles.list}>
        {sorted.length === 0 ? (
          <div className={styles.empty}>暂无审批请求</div>
        ) : (
          sorted.map((approval) => (
            <button
              key={approval.approvalRequestId}
              type="button"
              className={[
                styles.row,
                selected?.approvalRequestId === approval.approvalRequestId
                  ? styles.active
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => store.select(approval.approvalRequestId)}
            >
              <span className={styles.row1}>
                <span className={styles.id}>
                  {approval.approvalRequestId}
                </span>
                <span className={[styles.pill, styles[approval.status]].join(" ")}>
                  {STATUS_LABEL[approval.status]}
                </span>
              </span>
              <span className={styles.title}>{approval.title}</span>
              <span className={styles.meta}>
                {approval.toolName} · {formatTime(approval.requestedAt)}
              </span>
            </button>
          ))
        )}
      </nav>
      {selected !== undefined ? (
        <div className={styles.detail}>
          <div className={styles.identity}>
            <span className={styles.csId}>{selected.approvalRequestId}</span>
            <span className={styles.meta}>
              {selected.toolName} · digest {shortDigest(selected.argumentDigest)}
            </span>
          </div>
          <h4 className={styles.title}>{selected.title}</h4>
          {selected.description !== undefined ? (
            <p className={styles.desc}>{selected.description}</p>
          ) : null}
          {selected.operations !== undefined && selected.operations.length > 0 ? (
            <ul className={styles.ops}>
              {selected.operations.map((operation, index) => (
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
                  </span>
                  <span className={styles.opKind}>{operation.kind}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {selected.arguments !== undefined ? (
            <div className={styles.args}>
              <span className={styles.argsTitle}>完整参数</span>
              <pre className={styles.argsBody}>
                {JSON.stringify(selected.arguments, null, 2)}
              </pre>
            </div>
          ) : null}
          <div className={styles.statusLine}>
            <span className={[styles.pill, styles[selected.status]].join(" ")}>
              {STATUS_LABEL[selected.status]}
            </span>
            <span className={styles.meta}>
              请求 {formatTime(selected.requestedAt)}
              {selected.resolvedAt !== undefined
                ? ` · 处理 ${formatTime(selected.resolvedAt)}`
                : ""}
            </span>
          </div>
          {selected.status === "pending" ? (
            <div className={styles.actions}>
              <span className={styles.count}>
                {selected.operations?.length ?? 0} 处变更
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  void store.decide(selected.approvalRequestId, "approved");
                }}
              >
                批准
              </Button>
              <Button
                variant="ghost-danger"
                size="sm"
                onClick={() => {
                  void store.decide(selected.approvalRequestId, "rejected");
                }}
              >
                拒绝
              </Button>
            </div>
          ) : (
            <div className={styles.banner}>
              已处理 · {STATUS_LABEL[selected.status]}
              {selected.actorId !== undefined
                ? ` · ${selected.actorId}`
                : ""}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
