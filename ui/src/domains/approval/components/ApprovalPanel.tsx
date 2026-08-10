/**
 * ApprovalPanel
 *
 * 审批面板（原型 .insp-list + .appr-scroll + .identity + .detail-foot）：
 * 同一轮（turn）的多个工具审批合并为一个待审条目；目录按对话分组展示，
 * 下方为选中组的详情（审批参数 + 执行结果 + 批准/请求修改，作用于组内全部请求）。
 *
 * v2 原型对齐：删除悬浮预览（.apprHover）与内部标识（.id/.csId/◈ 不可变），
 * 目录按对话分组（.apprGroup + .agJump「跳转」）；详情不再展示大纲/正文/实体
 * 变更 diff 区，参数以中文标签行呈现（ParameterView），工具名中文化。
 * 目录始终为左侧滑出覆盖抽屉（无常驻列），触发按钮「目录 N」在 InspectorHost
 * 头部；宿主传入 drawerOpen/onToggleDrawer，选中条目自动收起。
 *
 * Approval panel: per-turn grouped request list on top, group detail below
 * with Chinese-labelled parameters, execution result, and approve/reject
 * actions across the group. Diff sections for outline/entity changes are gone.
 */
import { useMemo, useState } from "react";
import { Button } from "../../../shared/primitives/Button.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import { toolNameLabel } from "../paramLabels.js";
import type { ApprovalStore, ApprovalView } from "../ApprovalStore.js";
import styles from "./ApprovalPanel.module.css";
import { ParameterView } from "./ParameterView.js";

export interface ApprovalPanelProps {
  readonly store: ApprovalStore;
  /** 会话 id → 标题（用于全局审批归属展示）。Conversation title labels. */
  readonly conversationLabels?: ReadonlyMap<string, string>;
  /** 目录「跳转」：切换主视图到该对话（应用层负责 select + transition）。 */
  readonly onJumpToConversation?: (conversationId: string) => void;
  /** 目录覆盖抽屉是否展开。 */
  readonly drawerOpen?: boolean;
  readonly onToggleDrawer?: (open: boolean) => void;
}

interface ApprovalGroup {
  readonly key: string;
  readonly approvals: readonly ApprovalView[];
  readonly status: ApprovalView["status"];
  readonly requestedAt: string;
}

/** 按对话聚合后的目录节。 */
interface ConversationApprovalGroup {
  readonly conversationId: string;
  readonly groups: readonly ApprovalGroup[];
}

const STATUS_LABEL: Record<ApprovalView["status"], string> = {
  pending: "待批准",
  approved: "已批准",
  rejected: "已拒绝",
  cancelled: "已取消",
  expired: "已过期",
};

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
  return `${approval.conversationId}:${approval.turnId ?? approval.approvalRequestId}`;
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

/** 把已排序的审批组按对话聚合（组间保持最近审批降序，目录头展示会话）。 */
function groupByConversation(
  groups: readonly ApprovalGroup[],
): readonly ConversationApprovalGroup[] {
  const raw = new Map<string, ApprovalGroup[]>();
  for (const group of groups) {
    const conversationId = group.approvals[0].conversationId;
    const list = raw.get(conversationId) ?? [];
    list.push(group);
    raw.set(conversationId, list);
  }
  return Object.freeze(
    [...raw.entries()].map(([conversationId, list]) =>
      Object.freeze({
        conversationId,
        groups: Object.freeze(list),
      }),
    ),
  );
}

export function ApprovalPanel({
  store,
  conversationLabels,
  onJumpToConversation,
  drawerOpen = false,
  onToggleDrawer,
}: ApprovalPanelProps) {
  const snapshot = useExternalStore(store);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);
  const groups = useMemo(
    () => groupApprovals(snapshot.approvals),
    [snapshot.approvals],
  );
  const conversationGroups = useMemo(
    () => groupByConversation(groups),
    [groups],
  );
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

  const conversationLabel = (conversationId: string): string => {
    return conversationLabels?.get(conversationId) ?? shortId(conversationId);
  };

  // 选中目录条目：记录选中 key 并自动收起抽屉（窄面板模式）。
  const selectGroup = (key: string): void => {
    setSelectedKey(key);
    onToggleDrawer?.(false);
  };

  const argumentGroups = selectedGroup?.approvals.flatMap((approval) =>
    approval.arguments === undefined
      ? []
      : [{ toolName: approval.toolName, arguments: approval.arguments }],
  );

  return (
    <div
      className={[styles.panel, drawerOpen ? styles.drawerOpen : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={styles.scrim}
        onClick={() => onToggleDrawer?.(false)}
        aria-hidden="true"
      />
      <nav className={styles.list} id="approval-directory">
        <div className={styles.dirHead}>
          审批队列
          <span className={styles.cnt}>{groups.length}</span>
        </div>
        {groups.length === 0 ? (
          <div className={styles.empty}>暂无审批请求</div>
        ) : (
          conversationGroups.map((conversationGroup) => {
            const { conversationId, groups: groupList } = conversationGroup;
            return (
              <div key={conversationId} className={styles.apprGroup}>
                <div className={styles.apprGroupHead}>
                  <span className={styles.agMain}>
                    <span className={styles.agName}>
                      {conversationLabel(conversationId)}
                    </span>
                    <span className={styles.agSub}>{groupList.length} 组</span>
                  </span>
                  {onJumpToConversation !== undefined ? (
                    <button
                      type="button"
                      className={styles.agJump}
                      onClick={() => onJumpToConversation(conversationId)}
                    >
                      跳转
                    </button>
                  ) : null}
                </div>
                {groupList.map((group) => {
                  const toolNames = [
                    ...new Set(
                      group.approvals.map((approval) => approval.toolName),
                    ),
                  ];
                  const conversationDisposed =
                    group.approvals[0].conversationStatus !== "active";
                  const legacy = group.approvals.every(
                    (approval) =>
                      (approval.operations?.length ?? 0) === 0 &&
                      approval.arguments === undefined,
                  );
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
                      onClick={() => selectGroup(group.key)}
                    >
                      <span className={styles.row1}>
                        <span
                          className={[styles.pill, styles[group.status]].join(" ")}
                        >
                          {group.status === "pending" &&
                          group.approvals.length > 1
                            ? `待批准 ${group.approvals.length} 项`
                            : STATUS_LABEL[group.status]}
                        </span>
                      </span>
                      <span className={styles.title}>{label}</span>
                      {legacy ? <span className={styles.legacy}>旧版</span> : null}
                      {conversationDisposed ? (
                        <span className={styles.legacy}>会话已删除</span>
                      ) : null}
                      <span className={styles.meta}>
                        {toolNames.map(toolNameLabel).join(" · ")} ·{" "}
                        {formatTime(group.requestedAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </nav>
      {selectedGroup !== undefined ? (
        <div className={styles.detail}>
          <div className={styles.identity}>
            <span className={styles.meta}>
              {conversationLabel(selectedGroup.approvals[0].conversationId)} ·{" "}
              {selectedGroup.approvals
                .map((approval) => toolNameLabel(approval.toolName))
                .join(" · ")}
            </span>
            <span
              className={[styles.pill, styles[selectedGroup.status]].join(" ")}
            >
              {STATUS_LABEL[selectedGroup.status]}
            </span>
          </div>
          <h4 className={styles.title}>{selectedGroup.approvals[0].title}</h4>
          {argumentGroups !== undefined && argumentGroups.length > 0 ? (
            <div className={styles.args}>
              <span className={styles.argsTitle}>审批参数</span>
              {argumentGroups.map((group, index) => (
                <div
                  key={`${group.toolName}-${index}`}
                  className={styles.argsGroup}
                >
                  <span className={styles.argsTool}>
                    {toolNameLabel(group.toolName)}
                  </span>
                  <ParameterView value={group.arguments} />
                </div>
              ))}
            </div>
          ) : null}
          <section className={styles.diffSec}>
            <h3 className={styles.diffTitle}>执行结果</h3>
            {selectedGroup.status === "pending" ? (
              <p className={styles.diffPlaceholder}>等待批准后执行</p>
            ) : (
              <p className={styles.diffPlaceholder}>
                {STATUS_LABEL[selectedGroup.status]}
                {selectedGroup.approvals[0].resolvedAt !== undefined
                  ? ` · ${formatTime(selectedGroup.approvals[0].resolvedAt)}`
                  : ""}
                {selectedGroup.approvals[0].actorId !== undefined
                  ? ` · ${selectedGroup.approvals[0].actorId}`
                  : ""}
              </p>
            )}
          </section>
          {(argumentGroups?.length ?? 0) === 0 ? (
            <p className={styles.emptyDetail}>
              旧版本审批 · 无参数详情（建议在新会话重新发起写入）
            </p>
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
                disabled={selectedGroup.approvals[0].conversationStatus !== "active"}
                onClick={() => decideGroup(selectedGroup, "approved")}
              >
                批准
              </Button>
              <Button
                variant="ghost-danger"
                size="sm"
                disabled={selectedGroup.approvals[0].conversationStatus !== "active"}
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
