/**
 * ApprovalGroupDetail
 *
 * 一个审批组的完整详情（自原 ApprovalPanel 卡片抽出，供弹窗右栏复用）：
 * 身份行（工具名·状态 pill）+ 标题（diff 符号）+ 两段式内容
 * （当前内容·将被覆盖/删除 + 写入内容/变更后/删除参数）+ 决策按钮/意见输入/已处理横幅。
 * ExitComposeMode 组详情区改渲染 design 文件全文（经 platform.designFile，可编辑保存）。
 * 组内整批决策（core WaitRequestQueue 粒度：组 = 一次请求及其重试）。
 */
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Clock, Pencil, Plus, X, type LucideIcon } from "lucide-react";
import { Button } from "../../../shared/primitives/Button.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { ApprovalEntityResolver } from "../approvalEntityResolver.js";
import {
  APPROVAL_STATUS_LABEL,
  isExitComposeGroup,
  parseApprovalArgs,
  type ApprovalGroup,
} from "../approvalGroups.js";
import { inferOperation, operationGlyph, toolNameLabel } from "../paramLabels.js";
import type { ApprovalStore } from "../ApprovalStore.js";
import type { JsonValue } from "../jsonTypes.js";
import styles from "./ApprovalPanel.module.css";
import { ApprovalEntityView } from "./ApprovalEntityView.js";
import { ParameterView } from "./ParameterView.js";
import { useApprovalEntityResolution } from "./useApprovalEntityResolution.js";
import { ExitComposeApprovalView } from "./ExitComposeApprovalView.js";

/** 方案 E：标题 diff 符号 class。 */
const OP_GLYPH_CLASS: Record<string, string | undefined> = {
  add: styles.titleGlyphAdd,
  edit: styles.titleGlyphEdit,
  delete: styles.titleGlyphDel,
};

/** apCur 块操作色 class（edit=warn 左线、delete=danger 左线、add=虚线）。 */
const OP_CUR_CLASS: Record<string, string | undefined> = {
  add: styles.curAdd,
  edit: styles.curEdit,
  delete: styles.curDelete,
};

/** 方案 E：工具头整条色带 class。 */
const OP_BAND_CLASS: Record<string, string | undefined> = {
  add: styles.bandAdd,
  edit: styles.bandEdit,
  delete: styles.bandDel,
};

/** 「当前内容」段头文案（add 由解析结果另行判定）。 */
const OP_CURRENT_HEAD: Record<string, string> = {
  edit: "当前内容 · 将被覆盖",
  delete: "当前内容 · 将被删除",
};

/** 「变更后」段头文案。 */
const OP_CHANGE_HEAD: Record<string, string> = {
  add: "写入内容",
  edit: "变更后",
  delete: "删除参数",
};

/** 「变更后」段头操作图标。 */
const OP_CHANGE_ICON: Record<string, LucideIcon> = {
  add: Plus,
  edit: Pencil,
  delete: X,
};

/** markdown 文档文件扩展（Write 的 content 为 md 全文 → 审批弹窗 markdown 渲染）。 */
const MD_FILE_EXT_RE = /\.(md|markdown)$/i;

/** 参数含 file_path（.md/.markdown）+ 字符串 content → markdown 文档写入。 */
function isMarkdownDocArgs(args: JsonValue | undefined): boolean {
  return (
    args !== undefined &&
    args !== null &&
    typeof args === "object" &&
    !Array.isArray(args) &&
    typeof args.file_path === "string" &&
    MD_FILE_EXT_RE.test(args.file_path) &&
    typeof args.content === "string"
  );
}

export interface ApprovalGroupDetailProps {
  readonly group: ApprovalGroup;
  readonly store: ApprovalStore;
  /** 删除/编辑目标实体内容解析器（宿主注入）。 */
  readonly resolveEntity?: ApprovalEntityResolver;
}

export function ApprovalGroupDetail({ group, store, resolveEntity }: ApprovalGroupDetailProps) {
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
        approval.toolCalls.map((tc) => {
          const args = parseApprovalArgs(tc.args);
          return {
            toolName: tc.toolName,
            arguments: args,
            op: inferOperation(tc.toolName),
            markdownDoc: isMarkdownDocArgs(args),
          };
        }),
      ),
    [group],
  );
  const op = inferOperation(group.approvals[0]!.toolCalls[0]!.toolName ?? "");
  const isExitCompose = isExitComposeGroup(group);
  // 已决审批不再解析实体内容；仅待批准解析并判断 revision 是否过期。
  const isPending = group.status === "pending";
  const resolutions = useApprovalEntityResolution(
    isPending && !isExitCompose ? argumentGroups : undefined,
    resolveEntity,
  );

  return (
    <div className={styles.detail}>
      <div className={styles.identity}>
        <span className={styles.meta}>
          {group.approvals
            .flatMap((approval) => approval.toolCalls.map((tc) => toolNameLabel(tc.toolName)))
            .join(" · ")}
        </span>
        <span className={[styles.pill, styles[group.status]].join(" ")}>
          {APPROVAL_STATUS_LABEL[group.status]}
        </span>
      </div>
      <h4 className={styles.title}>
        {op !== undefined ? (
          <span className={[styles.titleGlyph, OP_GLYPH_CLASS[op]].filter(Boolean).join(" ")}>
            {operationGlyph(op ?? "")}
          </span>
        ) : null}
        {group.title}
      </h4>
      {isExitCompose ? (
        // 设计草稿审批：md 全文展示（内容经 designFile 按会话读取，不经审批 payload）
        <ExitComposeApprovalView conversationId={group.approvals[0]!.conversationId} />
      ) : (
        <>
          {argumentGroups.length > 0 ? (
            argumentGroups.map((argumentGroup, index) => {
              const resolution = resolutions?.[index];
              const readyResolution =
                resolution !== undefined && resolution.status === "ready" ? resolution : undefined;
              const ready = readyResolution !== undefined;
              const op = argumentGroup.op;
              // 「当前内容」段：待审且可解析（或 add 空态）才出现。
              // add 的实体读取 404 → error，即「无既有数据 · 此操作为新建」。
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
                currentBody = <span className={styles.curEmpty}>无既有数据 · 此操作为新建</span>;
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
                        className={[styles.band, OP_BAND_CLASS[op ?? ""]].filter(Boolean).join(" ")}
                      >
                        <span className={styles.bandGlyph}>{operationGlyph(op ?? "")}</span>
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
                          <ParameterView
                            value={argumentGroup.arguments}
                            contentAsMarkdown={argumentGroup.markdownDoc}
                          />
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
            <div className={styles.commentCollapseInner} aria-hidden={!editingComment} inert={!editingComment}>
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
          已处理 · {APPROVAL_STATUS_LABEL[group.status]}
        </div>
      )}
    </div>
  );
}
