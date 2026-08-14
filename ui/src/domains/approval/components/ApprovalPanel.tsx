/**
 * ApprovalPanel
 *
 * 审批面板（对齐旧版结构）：目录按对话分组展示（新版单会话场景下每组=单请求），
 * 下方为选中组详情（审批参数 + 批准/拒绝，作用于组内全部请求）。
 * 删除/编辑审批经 resolveEntity（lite 解析器）解析目标实体当前内容替换原始
 * 参数展示；目标 baseRevision 与实体 entityVersion 不一致时显示失效提示。
 * 目录始终为左侧滑出覆盖抽屉（触发按钮「目录 N」在 InspectorHost 头部），
 * 宿主传入 drawerOpen/onToggleDrawer，选中条目自动收起。
 *
 * Approval panel: per-request grouped list on top, group detail below with
 * Chinese-labelled parameters, approve/reject actions. Delete/edit groups
 * resolve the target entity's current content and flag stale approvals.
 */
import { useMemo, useState, type JSX } from "react";
import { Button } from "../../../shared/primitives/Button.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { ApprovalQueueItem } from "@novel/core";
import type { ApprovalEntityResolver } from "../approvalEntityResolver.js";
import type { JsonObject, JsonValue } from "../jsonTypes.js";
import {
  inferOperation,
  operationGlyph,
  toolNameLabel,
} from "../paramLabels.js";
import type { ApprovalStore } from "../ApprovalStore.js";
import styles from "./ApprovalPanel.module.css";
import { ApprovalEntityView } from "./ApprovalEntityView.js";
import { ParameterView } from "./ParameterView.js";
import { useApprovalEntityResolution } from "./useApprovalEntityResolution.js";
import { ExitComposeApprovalView } from "./ExitComposeApprovalView.js";

export interface ApprovalPanelProps {
  readonly store: ApprovalStore;
  /** 会话 id → 标题（用于审批归属展示）。Conversation title labels. */
  readonly conversationLabels?: ReadonlyMap<string, string>;
  /** 删除/编辑目标实体内容解析器（宿主注入）。Entity content resolver. */
  readonly resolveEntity?: ApprovalEntityResolver;
  /** 目录「跳转」：切换主视图到该对话（应用层负责 select + transition）。 */
  readonly onJumpToConversation?: (conversationId: string) => void;
  /** 目录覆盖抽屉是否展开。 */
  readonly drawerOpen?: boolean;
  readonly onToggleDrawer?: (open: boolean) => void;
}

interface ApprovalGroup {
  readonly key: string;
  readonly approvals: readonly ApprovalQueueItem[];
  readonly status: ApprovalQueueItem["status"];
  readonly requestedAt: string;
  /** 组标题（由首条审批 args 解析，group 级一次计算，避免渲染期 JSON.parse）。 */
  readonly title: string;
}

/** 按对话聚合后的目录节。 */
interface ConversationApprovalGroup {
  readonly conversationId: string;
  readonly groups: readonly ApprovalGroup[];
}

const STATUS_LABEL: Record<ApprovalQueueItem["status"], string> = {
  pending: "待批准",
  approved: "已批准",
  rejected: "已拒绝",
  edited: "已修改",
  expired: "已过期",
};

/** 方案 E：工具头整条色带 class。E band tone classes. */
const OP_BAND_CLASS: Record<string, string | undefined> = {
  add: styles.bandAdd,
  edit: styles.bandEdit,
  delete: styles.bandDel,
};

/** 方案 E：标题 diff 符号 class。E title glyph tone classes. */
const OP_GLYPH_CLASS: Record<string, string | undefined> = {
  add: styles.titleGlyphAdd,
  edit: styles.titleGlyphEdit,
  delete: styles.titleGlyphDel,
};

function shortId(value: string): string {
  return value.length > 24 ? `…${value.slice(-12)}` : value;
}

/** args JSON 字符串 → JsonValue（解析失败 undefined → 面板走「无参数详情」降级） */
function parseApprovalArgs(args: string): JsonValue | undefined {
  try {
    return JSON.parse(args) as JsonValue;
  } catch {
    return undefined;
  }
}

/** 审批标题派生：从 args 提取实体名（写：values[0].name/title；编辑：patch.name；删除：id） */
function approvalTitleOf(toolName: string, args: string): string {
  const parsed = parseApprovalArgs(args);
  const fallback = toolNameLabel(toolName) ?? toolName;
  if (parsed === undefined || typeof parsed !== "object" || parsed === null) {
    return fallback;
  }
  const record = parsed as JsonObject;
  if (Array.isArray(record.values) && record.values.length > 0) {
    const first = record.values[0];
    if (typeof first === "object" && first !== null) {
      const item = first as JsonObject;
      const name =
        (typeof item.name === "string" ? item.name : undefined) ??
        (typeof item.title === "string" ? item.title : undefined);
      if (name !== undefined) return name;
      const patch = item.patch;
      if (typeof patch === "object" && patch !== null) {
        const patchName = (patch as JsonObject).name;
        if (typeof patchName === "string") return patchName;
      }
    }
  }
  // 单对象形态（ParagraphWrite/OutlineWrite/PublicationWrite 等）
  if (typeof record.name === "string") return record.name;
  if (typeof record.title === "string") return record.title;
  return fallback;
}

function groupKeyOf(approval: ApprovalQueueItem): string {
  return `${approval.conversationId}:${approval.requestId}`;
}

function groupStatus(approvals: readonly ApprovalQueueItem[]): ApprovalQueueItem["status"] {
  if (approvals.some((item) => item.status === "pending")) return "pending";
  if (approvals.some((item) => item.status === "rejected")) return "rejected";
  return approvals[approvals.length - 1]!.status;
}

function groupApprovals(
  approvals: readonly ApprovalQueueItem[],
): readonly ApprovalGroup[] {
  const raw = new Map<string, ApprovalQueueItem[]>();
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
          requestedAt: list[0]!.requestedAt,
          // ExitComposeMode：固定标题「提交设计草稿」（设计内容经 designFile 读取展示）
          title:
            list[0]!.toolName === "ExitComposeMode"
              ? "提交设计草稿"
              : approvalTitleOf(list[0]!.toolName, list[0]!.args),
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
    const conversationId = group.approvals[0]!.conversationId;
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
  resolveEntity,
  onJumpToConversation,
  drawerOpen = false,
  onToggleDrawer,
}: ApprovalPanelProps) {
  const snapshot = useExternalStore(store);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);
  // 「请求修改」意见输入
  const [editingComment, setEditingComment] = useState(false);
  const [commentText, setCommentText] = useState("");
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
            (approval) => approval.requestId === snapshot.selectedId,
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
        void store.decide(approval.requestId, decision);
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

  const argumentGroups = useMemo(
    () =>
      selectedGroup?.approvals.map((approval) => ({
        toolName: approval.toolName,
        arguments: parseApprovalArgs(approval.args),
        op: inferOperation(approval.toolName),
      })),
    [selectedGroup],
  );
  const selectedOp = inferOperation(
    selectedGroup?.approvals[0]!.toolName ?? "",
  );
  // ExitComposeMode：设计草稿审批（无实体参数，详情区改渲染 design 文件全文）
  const isExitCompose =
    selectedGroup?.approvals[0]?.toolName === "ExitComposeMode";
  // 已决审批不再解析实体内容（批准后 canonical 已变，取到的是新状态）；
  // 仅待批准解析并判断 revision 是否过期。ExitComposeMode 无实体参数，不解析。
  const isPending = selectedGroup?.status === "pending";
  const resolutions = useApprovalEntityResolution(
    isPending && !isExitCompose ? argumentGroups : undefined,
    resolveEntity,
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
                    <span className={styles.agSub}>{groupList.length} 项</span>
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
                  const label =
                    group.approvals.length > 1
                      ? `${group.title} 等 ${group.approvals.length} 项`
                      : group.title;
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
                      <span
                        className={[styles.pill, styles[group.status]].join(" ")}
                      >
                        {group.status === "pending" &&
                        group.approvals.length > 1
                          ? `待批准 ${group.approvals.length} 项`
                          : STATUS_LABEL[group.status]}
                      </span>
                      <span className={styles.rowTitle}>{label}</span>
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
              {conversationLabel(selectedGroup.approvals[0]!.conversationId)} ·{" "}
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
          <h4 className={styles.title}>
            {selectedOp !== undefined ? (
              <span
                className={[styles.titleGlyph, OP_GLYPH_CLASS[selectedOp]]
                  .filter(Boolean)
                  .join(" ")}
              >
                {operationGlyph(selectedOp)}
              </span>
            ) : null}
            {selectedGroup.title}
          </h4>
          {isExitCompose ? (
            // 设计草稿审批：md 全文展示（内容经 designFile 按会话读取，不经审批 payload）
            <ExitComposeApprovalView
              conversationId={selectedGroup.approvals[0]!.conversationId}
            />
          ) : (
            <>
              {argumentGroups !== undefined && argumentGroups.length > 0 ? (
                <div className={styles.args}>
                  <span className={styles.argsTitle}>审批参数</span>
                  {argumentGroups.map((group, index) => {
                    const resolution = resolutions?.[index];
                    let body: JSX.Element;
                    if (
                      resolution !== undefined &&
                      resolution.status === "ready"
                    ) {
                      body = (
                        <>
                          {resolution.stale ? (
                            <div className={styles.staleBanner}>
                              版本已过期：正式稿已被其他修改更新，批准后此操作可能执行失败
                            </div>
                          ) : null}
                          {resolution.contents.map((content, contentIndex) => (
                            <div key={content.id}>
                              {contentIndex > 0 ? (
                                <div className={styles.resolvedDivider} />
                              ) : null}
                              <ApprovalEntityView content={content} />
                            </div>
                          ))}
                        </>
                      );
                    } else if (
                      resolution !== undefined &&
                      resolution.status === "loading"
                    ) {
                      body = (
                        <span className={styles.loadingHint}>内容解析中…</span>
                      );
                    } else {
                      body =
                        group.arguments !== undefined ? (
                          <ParameterView value={group.arguments} tone={group.op} />
                        ) : (
                          <span className={styles.loadingHint}>
                            旧版本审批 · 无参数详情
                          </span>
                        );
                    }
                    return (
                      <div
                        key={`${group.toolName}-${index}`}
                        className={styles.argsGroup}
                      >
                        <div
                          className={[styles.band, OP_BAND_CLASS[group.op ?? ""]]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <span className={styles.bandGlyph}>
                            {operationGlyph(group.op ?? "")}
                          </span>
                          <span className={styles.bandTool}>
                            {toolNameLabel(group.toolName)}
                          </span>
                        </div>
                        <div className={styles.body}>{body}</div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {(argumentGroups?.length ?? 0) === 0 ? (
                <p className={styles.emptyDetail}>
                  旧版本审批 · 无参数详情（建议在新会话重新发起写入）
                </p>
              ) : null}
            </>
          )}
          {selectedGroup.status === "pending" ? (
            <>
              <div className={styles.actions}>
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingComment(!editingComment)}
                >
                  请求修改
                </Button>
              </div>
              {editingComment ? (
                <div className={styles.commentBox}>
                  <textarea
                    className={styles.commentInput}
                    rows={3}
                    placeholder="填写修改意见（将随决策回传会话）"
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                  />
                  <div className={styles.actions}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingComment(false)}
                    >
                      取消
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={commentText.trim() === ""}
                      onClick={() => {
                        for (const approval of selectedGroup.approvals) {
                          if (approval.status === "pending") {
                            void store.decideEdited(approval.requestId, commentText.trim());
                          }
                        }
                        setEditingComment(false);
                        setCommentText("");
                      }}
                    >
                      提交修改意见
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
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
