/**
 * ApprovalPanel
 *
 * 审批面板（PRD §9 · 卡片流）：只展示当前会话（conversationId）的审批记录，
 * 一次调用带来的一批审批作为卡片纵向堆叠、逐项决策——无目录列
 * （决议：一次 call 一批一起审）。每组 = 一次审批请求及其重试。
 * 删除/编辑审批经 resolveEntity（lite 解析器）解析目标实体当前内容（「当前内容」区）
 * 替换原始参数展示；目标 baseRevision 与实体 entityVersion 不一致时显示失效提示。
 * ExitComposeMode 组固定标题「提交设计草稿」，详情区渲染 design 文件全文。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import { Clock, Pencil, Plus, X, type LucideIcon } from "lucide-react";
import { Button } from "../../../shared/primitives/Button.js";
import { Icon } from "../../../shared/primitives/Icon.js";
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
  /** 展示的会话 id；缺省展示全部（向后兼容宿主未传的用法）。 */
  readonly conversationId?: string;
  /** 删除/编辑目标实体内容解析器（宿主注入）。Entity content resolver. */
  readonly resolveEntity?: ApprovalEntityResolver;
}

interface ApprovalGroup {
  readonly key: string;
  readonly approvals: readonly ApprovalQueueItem[];
  readonly status: ApprovalQueueItem["status"];
  readonly requestedAt: string;
  /** 组标题（由首条审批 args 解析，group 级一次计算，避免渲染期 JSON.parse）。 */
  readonly title: string;
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

/** 方案 E：apCur 块操作色 class（edit=warn 左线、delete=danger 左线、add=虚线）。 */
const OP_CUR_CLASS: Record<string, string | undefined> = {
  add: styles.curAdd,
  edit: styles.curEdit,
  delete: styles.curDelete,
};

/** 「当前内容」段头文案（demo apCardHTML curHead）：add 由解析结果另行判定。 */
const OP_CURRENT_HEAD: Record<string, string> = {
  edit: "当前内容 · 将被覆盖",
  delete: "当前内容 · 将被删除",
};

/** 「变更后」段头文案（demo AP_OP_SECTION）。 */
const OP_CHANGE_HEAD: Record<string, string> = {
  add: "写入内容",
  edit: "变更后",
  delete: "删除参数",
};

/** 「变更后」段头操作图标（demo ic：delete=x / add=plus / edit=edit）。 */
const OP_CHANGE_ICON: Record<string, LucideIcon> = {
  add: Plus,
  edit: Pencil,
  delete: X,
};

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
            list[0]!.toolCalls[0]!.toolName === "ExitComposeMode"
              ? "提交设计草稿"
              : approvalTitleOf(list[0]!.toolCalls[0]!.toolName, list[0]!.toolCalls[0]!.args),
        }),
      )
      // 最新审批在前，打开面板时默认看到最新的待审组。
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt)),
  );
}

/** 决策后行内状态脉冲色（--pulse-c 注入 status-pulse keyframe） */
const DECISION_PULSE_COLOR: Record<string, string> = {
  approved: "var(--color-success)",
  rejected: "var(--color-danger)",
  edited: "var(--color-info)",
};

/** 上次快照：新组播放入列动画、状态变化播状态脉冲（首帧全量静默） */
interface DirectoryDelta {
  readonly enteredKeys: ReadonlySet<string>;
  readonly pulsedKeys: ReadonlyMap<string, string>;
}

function diffDirectory(
  groups: readonly ApprovalGroup[],
  prev: ReadonlyMap<string, ApprovalQueueItem["status"]> | undefined,
): DirectoryDelta {
  const enteredKeys = new Set<string>();
  const pulsedKeys = new Map<string, string>();
  if (prev !== undefined) {
    for (const group of groups) {
      const before = prev.get(group.key);
      if (before === undefined) {
        enteredKeys.add(group.key);
      } else if (before !== group.status) {
        pulsedKeys.set(group.key, group.status);
      }
    }
  }
  return { enteredKeys, pulsedKeys };
}

/**
 * 审批卡片：一组审批（一次调用）的完整决策单元——
 * 身份行 + 标题 + 参数/实体当前内容 + 批准/拒绝/请求修改。
 */
function ApprovalGroupCard({
  group,
  store,
  resolveEntity,
  entered,
  pulseColor,
}: {
  readonly group: ApprovalGroup;
  readonly store: ApprovalStore;
  readonly resolveEntity?: ApprovalEntityResolver;
  readonly entered: boolean;
  readonly pulseColor: string | undefined;
}) {
  // 「请求修改」意见输入（按组独立）
  const [editingComment, setEditingComment] = useState(false);
  const [commentText, setCommentText] = useState("");
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (editingComment) commentInputRef.current?.focus();
  }, [editingComment]);

  const decideGroup = (decision: "approved" | "rejected"): void => {
    for (const approval of group.approvals) {
      if (approval.status === "pending") {
        void store.decide(approval.requestId, decision);
      }
    }
  };

  // 参数区按 toolCall 平铺：一个批次条目展开为多项
  const argumentGroups = useMemo(
    () =>
      group.approvals.flatMap((approval) =>
        approval.toolCalls.map((tc) => ({
          toolName: tc.toolName,
          arguments: parseApprovalArgs(tc.args),
          op: inferOperation(tc.toolName),
        })),
      ),
    [group],
  );
  const op = inferOperation(group.approvals[0]!.toolCalls[0]!.toolName ?? "");
  // ExitComposeMode：设计草稿审批（无实体参数，详情区改渲染 design 文件全文）
  const isExitCompose = group.approvals[0]?.toolCalls[0]?.toolName === "ExitComposeMode";
  // 已决审批不再解析实体内容；仅待批准解析并判断 revision 是否过期。
  const isPending = group.status === "pending";
  const resolutions = useApprovalEntityResolution(
    isPending && !isExitCompose ? argumentGroups : undefined,
    resolveEntity,
  );

  const cardStyle =
    pulseColor !== undefined ? ({ "--pulse-c": pulseColor } as CSSProperties) : undefined;

  return (
    <section
      className={[
        styles.card,
        entered ? styles.enter : "",
        pulseColor !== undefined ? styles.pulse : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={cardStyle}
    >
      <div className={styles.identity}>
        <span className={styles.meta}>
          {group.approvals
            .flatMap((approval) =>
              approval.toolCalls.map((tc) => toolNameLabel(tc.toolName)),
            )
            .join(" · ")}
        </span>
        <span className={[styles.pill, styles[group.status]].join(" ")}>
          {STATUS_LABEL[group.status]}
        </span>
      </div>
      <h4 className={styles.title}>
        {op !== undefined ? (
          <span
            className={[styles.titleGlyph, OP_GLYPH_CLASS[op]].filter(Boolean).join(" ")}
          >
            {operationGlyph(op)}
          </span>
        ) : null}
        {group.title}
      </h4>
      {isExitCompose ? (
        // 设计草稿审批：md 全文展示（内容经 designFile 按会话读取，不经审批 payload）
        <ExitComposeApprovalView
          conversationId={group.approvals[0]!.conversationId}
        />
      ) : (
        <>
          {argumentGroups.length > 0 ? (
            argumentGroups.map((argumentGroup, index) => {
              const resolution = resolutions?.[index];
              const readyResolution =
                resolution !== undefined && resolution.status === "ready" ? resolution : undefined;
              const ready = readyResolution !== undefined;
              const op = argumentGroup.op;
              // 「当前内容」段：待审且可解析（或 add 空态）才出现（demo apSection + apCur）。
              // add 的实体读取 404 → error，即 demo 的「无既有数据 · 此操作为新建」。
              const showCurrent =
                isPending &&
                resolution !== undefined &&
                (ready ||
                  resolution.status === "loading" ||
                  (op === "add" && (resolution.status === "unresolved" || resolution.status === "error")));
              const currentHead =
                op === "add"
                  ? ready
                    ? "当前内容 · 已存在同名数据"
                    : "当前内容"
                  : OP_CURRENT_HEAD[op ?? ""] ?? "当前内容";
              const changeHead = isPending ? OP_CHANGE_HEAD[op ?? ""] ?? "审批参数" : "审批参数";
              const changeIcon = OP_CHANGE_ICON[op ?? ""] ?? Pencil;
              let currentBody: JSX.Element | undefined;
              if (readyResolution !== undefined) {
                currentBody = (
                  <>
                    {readyResolution.contents.map((content, contentIndex) => (
                      <div key={content.id}>
                        {contentIndex > 0 ? <div className={styles.resolvedDivider} /> : null}
                        <ApprovalEntityView content={content} />
                      </div>
                    ))}
                  </>
                );
              } else if (resolution?.status === "loading") {
                currentBody = <span className={styles.loadingHint}>内容解析中…</span>;
              } else if (op === "add") {
                currentBody = (
                  <span className={styles.curEmpty}>无既有数据 · 此操作为新建</span>
                );
              }
              return (
                <div key={`${argumentGroup.toolName}-${index}`}>
                  {showCurrent ? (
                    <div className={styles.section}>
                      <div className={styles.sectionHead}>
                        <Icon icon={Clock} size="xs" />
                        {currentHead}
                      </div>
                      <div
                        className={[styles.cur, OP_CUR_CLASS[op ?? ""]].filter(Boolean).join(" ")}
                      >
                        {currentBody}
                      </div>
                    </div>
                  ) : null}
                  <div className={styles.section}>
                    <div className={styles.sectionHead}>
                      <Icon icon={changeIcon} size="xs" />
                      {changeHead}
                    </div>
                    <div className={styles.argsGroup}>
                      <div
                        className={[styles.band, OP_BAND_CLASS[op ?? ""]]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span className={styles.bandGlyph}>
                          {operationGlyph(op ?? "")}
                        </span>
                        <span className={styles.bandTool}>
                          {toolNameLabel(argumentGroup.toolName)}
                        </span>
                      </div>
                      <div className={styles.body}>
                        {readyResolution !== undefined && readyResolution.stale ? (
                          <div className={styles.staleBanner}>
                            版本已过期：正式稿已被其他修改更新，批准后此操作可能执行失败
                          </div>
                        ) : null}
                        {argumentGroup.arguments !== undefined ? (
                          <ParameterView value={argumentGroup.arguments} />
                        ) : (
                          <span className={styles.loadingHint}>旧版本审批 · 无参数详情</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <p className={styles.emptyDetail}>
              旧版本审批 · 无参数详情（建议在新会话重新发起写入）
            </p>
          )}
        </>
      )}
      {group.status === "pending" ? (
        <>
          <div className={styles.actions}>
            <Button variant="primary" size="sm" onClick={() => decideGroup("approved")}>
              批准
            </Button>
            <Button variant="ghost-danger" size="sm" onClick={() => decideGroup("rejected")}>
              拒绝
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditingComment(!editingComment)}>
              请求修改
            </Button>
          </div>
          {/* 0fr↔1fr 收展（GenStatus statusWrap 同款先例） */}
          <div className={styles.commentCollapsible} data-open={editingComment}>
            {/* 折叠态保持 DOM 以维持收展动画；inert+aria-hidden 移出可访问树与焦点序列 */}
            <div
              className={styles.commentCollapseInner}
              aria-hidden={!editingComment}
              inert={!editingComment}
            >
              <div className={styles.commentBox}>
                <textarea
                  ref={commentInputRef}
                  className={styles.commentInput}
                  rows={3}
                  placeholder="填写修改意见（将随决策回传会话）"
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                />
                <div className={styles.actions}>
                  <Button variant="ghost" size="sm" onClick={() => setEditingComment(false)}>
                    取消
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={commentText.trim() === ""}
                    onClick={() => {
                      for (const approval of group.approvals) {
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
            </div>
          </div>
        </>
      ) : (
        <div
          className={[
            styles.banner,
            styles[`banner_${group.status}`] ?? "",
          ].filter(Boolean).join(" ")}
        >
          已处理 · {STATUS_LABEL[group.status]}
        </div>
      )}
    </section>
  );
}

export function ApprovalPanel({ store, conversationId, resolveEntity }: ApprovalPanelProps) {
  const snapshot = useExternalStore(store);
  // 会话化：只展示当前会话的审批记录（宿主未传 conversationId 时退化为全量）
  const approvals = useMemo(
    () =>
      conversationId === undefined
        ? snapshot.approvals
        : snapshot.approvals.filter(
            (approval) => approval.conversationId === conversationId,
          ),
    [snapshot.approvals, conversationId],
  );
  const groups = useMemo(() => groupApprovals(approvals), [approvals]);
  // 卡片增量动画：新组 appr-in 入列、状态翻转 status-pulse。
  // 快照在 effect 中提交：render 期间读上一帧状态计算增量（StrictMode 双渲染
  // 下两遍都读到旧值，动画不丢；提交后同快照重渲染增量为空、不重放）。
  const prevStatusesRef = useRef<Map<string, ApprovalQueueItem["status"]> | undefined>(undefined);
  const delta = diffDirectory(groups, prevStatusesRef.current);
  useEffect(() => {
    prevStatusesRef.current = new Map(
      groups.map((group) => [group.key, group.status] as const),
    );
  }, [groups]);

  return (
    <div className={styles.panel}>
      <div className={styles.cards}>
        {groups.length === 0 ? (
          <div className={styles.empty}>暂无审批请求</div>
        ) : (
          groups.map((group) => (
            <ApprovalGroupCard
              key={group.key}
              group={group}
              store={store}
              resolveEntity={resolveEntity}
              entered={delta.enteredKeys.has(group.key)}
              pulseColor={DECISION_PULSE_COLOR[delta.pulsedKeys.get(group.key) ?? ""]}
            />
          ))
        )}
      </div>
    </div>
  );
}
