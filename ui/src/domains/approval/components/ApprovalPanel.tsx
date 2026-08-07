/**
 * ApprovalPanel
 *
 * 审批面板（原型 .insp-list + .appr-scroll + .identity + .detail-foot）：
 * 同一轮（turn）的多个工具审批合并为一个待审条目；上为分组列表，
 * 下为选中组的详情（操作行、完整参数、批准/请求修改，作用于组内全部请求）。
 *
 * Approval panel: per-turn grouped request list on top, group detail below
 * with merged op rows, full arguments, and approve/reject across the group.
 */
import { useMemo, useState } from "react";
import { Button } from "../../../shared/primitives/Button.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { ApprovalStore, ApprovalView } from "../ApprovalStore.js";
import styles from "./ApprovalPanel.module.css";

export interface ApprovalPanelProps {
  readonly store: ApprovalStore;
}

interface ApprovalGroup {
  readonly key: string;
  readonly approvals: readonly ApprovalView[];
  readonly status: ApprovalView["status"];
  readonly requestedAt: string;
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
  paragraph: "正文块",
  volume: "卷",
  chapter: "章节",
};

function opClass(op: string): string {
  if (op === "add") return styles.add;
  if (op === "edit") return styles.mod;
  if (op === "delete") return styles.del;
  return "";
}

function shortId(value: string): string {
  return value.length > 24 ? `…${value.slice(-12)}` : value;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function groupKeyOf(approval: ApprovalView): string {
  return approval.turnId ?? approval.approvalRequestId;
}

function groupStatus(approvals: readonly ApprovalView[]): ApprovalView["status"] {
  if (approvals.some((item) => item.status === "pending")) return "pending";
  if (approvals.some((item) => item.status === "rejected")) return "rejected";
  return approvals[approvals.length - 1].status;
}

function groupApprovals(
  approvals: readonly ApprovalView[],
): readonly ApprovalGroup[] {
  const raw = new Map<string, ApprovalView[]>();
  for (const approval of approvals) {
    const key = groupKeyOf(approval);
    const list = raw.get(key) ?? [];
    list.push(approval);
    raw.set(key, list);
  }
  return Object.freeze(
    [...raw.entries()]
      .map(([key, list]) =>
        Object.freeze({
          key,
          approvals: Object.freeze(list),
          status: groupStatus(list),
          requestedAt: list[0].requestedAt,
        }),
      )
      // 最新审批在前，打开面板时默认看到最新的待审组。
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt)),
  );
}

export function ApprovalPanel({ store }: ApprovalPanelProps) {
  const snapshot = useExternalStore(store);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);
  const [hoveredKey, setHoveredKey] = useState<string | undefined>(undefined);
  const groups = useMemo(
    () => groupApprovals(snapshot.approvals),
    [snapshot.approvals],
  );
  const hoveredGroup =
    groups.find((group) => group.key === hoveredKey) ?? undefined;
  const selectedGroup =
    groups.find((group) => group.key === selectedKey) ??
    (snapshot.selectedId === undefined
      ? undefined
      : groups.find((group) =>
          group.approvals.some(
            (approval) => approval.approvalRequestId === snapshot.selectedId,
          ),
        )) ??
    groups.find((group) => group.status === "pending") ??
    groups[0];

  const decideGroup = (
    group: ApprovalGroup,
    decision: "approved" | "rejected",
  ): void => {
    for (const approval of group.approvals) {
      if (approval.status === "pending") {
        void store.decide(approval.approvalRequestId, decision);
      }
    }
  };

  const operations = selectedGroup?.approvals.flatMap(
    (approval) => approval.operations ?? [],
  );
  const argumentGroups = selectedGroup?.approvals.flatMap((approval) =>
    approval.arguments === undefined
      ? []
      : [{ toolName: approval.toolName, arguments: approval.arguments }],
  );

  return (
    <div className={styles.panel}>
      <nav className={styles.list}>
        <div className={styles.dirHead}>
          审批队列
          <span className={styles.cnt}>{groups.length}</span>
        </div>
        {groups.length === 0 ? (
          <div className={styles.empty}>暂无审批请求</div>
        ) : (
          groups.map((group) => {
            const toolNames = [
              ...new Set(group.approvals.map((approval) => approval.toolName)),
            ];
            const title = group.approvals[0].title;
            const label =
              group.approvals.length > 1
                ? `${title} 等 ${group.approvals.length} 项`
                : title;
            return (
              <button
                key={group.key}
                type="button"
                className={[
                  styles.row,
                  selectedGroup?.key === group.key ? styles.active : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setSelectedKey(group.key)}
                onMouseEnter={() => setHoveredKey(group.key)}
                onMouseLeave={() =>
                  setHoveredKey((current) =>
                    current === group.key ? undefined : current,
                  )
                }
              >
                <span className={styles.row1}>
                  <span className={styles.id}>{shortId(group.key)}</span>
                  <span
                    className={[styles.pill, styles[group.status]].join(" ")}
                  >
                    {group.status === "pending" && group.approvals.length > 1
                      ? `待批准 ${group.approvals.length} 项`
                      : STATUS_LABEL[group.status]}
                  </span>
                </span>
                <span className={styles.title}>{label}</span>
                <span className={styles.meta}>
                  {toolNames.join(" · ")} · {formatTime(group.requestedAt)}
                </span>
              </button>
            );
          })
        )}
      </nav>
      {hoveredGroup !== undefined ? (
        <div className={styles.apprHover} role="tooltip">
          <div className={styles.ahHead}>
            <span className={styles.ahId}>{shortId(hoveredGroup.key)}</span>
            <span className={[styles.pill, styles[hoveredGroup.status]].join(" ")}>
              {STATUS_LABEL[hoveredGroup.status]}
            </span>
          </div>
          <span className={styles.ahTitle}>{hoveredGroup.approvals[0].title}</span>
          <span className={styles.ahMeta}>
            {[
              ...new Set(
                hoveredGroup.approvals.map((approval) => approval.toolName),
              ),
            ].join(" · ")}
          </span>
          {hoveredGroup.approvals.some(
            (approval) => (approval.operations?.length ?? 0) > 0,
          ) ? (
            <ul className={styles.ahOps}>
              {hoveredGroup.approvals
                .flatMap((approval) => approval.operations ?? [])
                .slice(0, 3)
                .map((operation, index) => (
                  <li key={`${operation.op}-${operation.id ?? operation.title ?? index}`}>
                    <span className={[styles.ahMark, styles[operation.op]].join(" ")}>
                      {OP_SYMBOL[operation.op] ?? "•"}
                    </span>
                    {operation.title ?? operation.id ?? operation.kind}
                  </li>
                ))}
            </ul>
          ) : null}
          <span className={styles.ahHint}>点击查看审批参数 →</span>
        </div>
      ) : null}
      {selectedGroup !== undefined ? (
        <div className={styles.detail}>
          <div className={styles.identity}>
            <span className={styles.csId}>{shortId(selectedGroup.key)}</span>
            <span className={styles.meta}>
              {selectedGroup.approvals
                .map((approval) => approval.toolName)
                .join(" · ")}
            </span>
            <span className={styles.immutable}>◈ 不可变</span>
          </div>
          <h4 className={styles.title}>{selectedGroup.approvals[0].title}</h4>
          {operations !== undefined && operations.length > 0 ? (
            <ul className={styles.ops}>
              {operations.map((operation, index) => (
                <li
                  key={`${operation.op}-${operation.id ?? operation.title ?? index}`}
                  className={[styles.op, opClass(operation.op)]
                    .filter(Boolean)
                    .join(" ")}
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
          {argumentGroups !== undefined && argumentGroups.length > 0 ? (
            <div className={styles.args}>
              <span className={styles.argsTitle}>完整参数</span>
              {argumentGroups.map((group, index) => (
                <div
                  key={`${group.toolName}-${index}`}
                  className={styles.argsGroup}
                >
                  <span className={styles.argsTool}>{group.toolName}</span>
                  <pre className={styles.argsBody}>
                    {JSON.stringify(group.arguments, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          ) : null}
          <div className={styles.statusLine}>
            <span
              className={[styles.pill, styles[selectedGroup.status]].join(" ")}
            >
              {STATUS_LABEL[selectedGroup.status]}
            </span>
            <span className={styles.meta}>
              请求 {formatTime(selectedGroup.requestedAt)}
            </span>
          </div>
          {selectedGroup.status === "pending" ? (
            <div className={styles.actions}>
              <span className={styles.count}>
                {selectedGroup.approvals.filter(
                  (approval) => approval.status === "pending",
                ).length}{" "}
                项待批准
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={() => decideGroup(selectedGroup, "approved")}
              >
                批准
              </Button>
              <Button
                variant="ghost-danger"
                size="sm"
                onClick={() => decideGroup(selectedGroup, "rejected")}
              >
                拒绝
              </Button>
            </div>
          ) : (
            <div className={styles.banner}>
              已处理 · {STATUS_LABEL[selectedGroup.status]}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
