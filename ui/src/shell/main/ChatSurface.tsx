/**
 * ChatSurface
 *
 * 组合对话域：timeline + composer；无对话时渲染空态。
 * binding 由 shell 持有注入（单实例不变量）；快照订阅在本组件内
 * （gui-performance-2 功能点五：流式发布只重渲染本子树，壳层零成本），
 * 发送经 sendUserMessage，时间线由 chatSurfaceMapper 映射（逐项缓存 + useMemo）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationMode } from "@novel/core";
import { debugLog, type ConversationProjectionErrorSnapshot } from "@novel/core/client";
import { Info, MoreHorizontal, Pencil, Pin, Trash2 } from "lucide-react";
import type { ToastKind } from "../../shared/state/ToastStore.js";
import { ChatEmptyState } from "../../domains/conversation/components/ChatEmptyState.js";
import {
  ConversationDialogs,
  type RenameTarget,
} from "../../domains/conversation/components/ConversationDialogs.js";
import { ConversationComposer } from "../../domains/conversation/components/ConversationComposer.js";
import { ConversationTimeline } from "../../domains/conversation/components/ConversationTimeline.js";
import type { GenStatusProps } from "../../domains/conversation/components/GenStatus.js";
import type { MessageReference } from "../../domains/conversation/components/MessageReference.js";
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import { ApprovalPendingBar } from "../../domains/approval/components/ApprovalPendingBar.js";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import { Icon } from "../../shared/primitives/Icon.js";
import { IconButton } from "../../shared/primitives/IconButton.js";
import { Dropdown, DropdownItem, DropdownSeparator } from "../../shared/primitives/Dropdown.js";
import type { ReferenceResolver } from "../../domains/conversation/reference/ReferenceResolver.js";
import type { ConversationProjectionBinding } from "../../domains/conversation/binding/ConversationProjectionBinding.js";
import { useActiveConversationSession } from "../../domains/conversation/hooks/useActiveConversationSession.js";
import { useConversationRuntimeStatus } from "../../domains/conversation/hooks/useConversationRuntimeStatus.js";
import { MainSubHead } from "./MainSubHead.js";
import { mapProjectionTimeline } from "./chatSurfaceMapper.js";
import styles from "./ChatSurface.module.css";

export interface ChatSurfaceProps {
  /** 活动会话投影 binding（shell 持有；本组件内订阅快照） */
  readonly conversationBinding: ConversationProjectionBinding | undefined;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly onCreateConversation: () => void;
  /** 本会话待审批数（CMS wait 队列派生；>0 时 composer 等待态） */
  readonly pendingApprovalCount?: number;
  /** 审批弹窗开合（挂起提示条显隐：弹窗开着时提示条让位） */
  readonly approvalModalOpen?: boolean;
  /** 唤起审批弹窗（挂起提示条 / 状态行 / 时间线系统行入口；可带 requestId 定位组） */
  readonly onSummonApproval?: (requestId?: string) => void;
  /** 打开会话信息面板（inspector conversation 路由；PRD 决议 1） */
  readonly onOpenConversationInfo?: (conversationId: string) => void;
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

export function ChatSurface({
  conversationBinding,
  conversationCatalog,
  onCreateConversation,
  pendingApprovalCount = 0,
  approvalModalOpen = false,
  onSummonApproval,
  onOpenConversationInfo,
  onReferenceClick,
  resolveReference,
  onNotify,
}: ChatSurfaceProps) {
  const catalog = useExternalStore(conversationCatalog);
  const activeId = catalog.activeConversationId;
  if (activeId === undefined) {
    return <ChatEmptyState onCreate={onCreateConversation} />;
  }
  const activeItem = catalog.conversations.find((item) => item.id === activeId);
  const title = activeItem?.title ?? "对话";
  return (
    <ActiveChatSurface
      conversationBinding={conversationBinding}
      conversationId={activeId}
      title={title}
      agentLabel={activeItem?.agentLabel}
      pinned={activeItem?.pinned === true}
      catalog={conversationCatalog}
      onTogglePin={() => {
        const next = !(activeItem?.pinned === true);
        void conversationCatalog
          .pinConversation(activeId, next)
          .then(() => onNotify?.("success", next ? `已置顶「${title}」` : "已取消置顶"))
          .catch(() => onNotify?.("danger", "操作失败，请重试"));
      }}
      onOpenInfo={onOpenConversationInfo !== undefined ? () => onOpenConversationInfo(activeId) : undefined}
      pendingApprovalCount={pendingApprovalCount}
      approvalModalOpen={approvalModalOpen}
      onSummonApproval={onSummonApproval}
      onReferenceClick={onReferenceClick}
      resolveReference={resolveReference}
      onNotify={onNotify}
    />
  );
}

interface ActiveChatSurfaceProps {
  readonly conversationBinding: ConversationProjectionBinding | undefined;
  readonly conversationId: string;
  readonly title: string;
  readonly agentLabel: string | undefined;
  readonly pinned: boolean;
  /** 目录 store：顶条菜单的重命名/删除 + 发送成功后 touchActivity */
  readonly catalog: ConversationCatalogStore;
  readonly onTogglePin: () => void;
  readonly onOpenInfo: (() => void) | undefined;
  readonly pendingApprovalCount: number;
  readonly approvalModalOpen: boolean;
  readonly onSummonApproval: ((requestId?: string) => void) | undefined;
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

function ActiveChatSurface({
  conversationBinding,
  conversationId,
  title,
  agentLabel,
  pinned,
  catalog,
  onTogglePin,
  onOpenInfo,
  pendingApprovalCount,
  approvalModalOpen,
  onSummonApproval,
  onReferenceClick,
  resolveReference,
  onNotify,
}: ActiveChatSurfaceProps) {
  const session = useActiveConversationSession(conversationBinding);
  const { snapshot, sendUserMessage, sendSystemControl, getConversationMode, resume } = session;
  const [sendError, setSendError] = useState<string | undefined>(undefined);
  // 顶条菜单的重命名/删除对话框（G7：自定义 Dialog 替代原生 prompt/confirm）
  const [renameTarget, setRenameTarget] = useState<RenameTarget | undefined>(undefined);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | undefined>(undefined);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const closeDialogs = (): void => {
    setRenameTarget(undefined);
    setRenameValue("");
    setDeleteTarget(undefined);
  };
  // 会话模式：权威回显 = 事件（projection.mode/modePending）；事件未达前经查询兜底。
  // mode.set 只记 pending（mode.pending 瞬态事件 → 回显「待生效」），active 切换由
  // mode.changed 权威事件驱动（provider call 发起时晋升）。
  const [queriedMode, setQueriedMode] = useState<ConversationMode>("review");
  useEffect(() => {
    let cancelled = false;
    void getConversationMode()
      .then((current) => {
        if (!cancelled) setQueriedMode(current);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [conversationId, getConversationMode, snapshot?.state]);
  const projection = snapshot?.projection;
  const mode: ConversationMode = projection?.mode ?? queriedMode;
  const pendingMode: ConversationMode | undefined = projection?.modePending;
  // mapper 按 core 项缓存：历史项跨快照引用稳定（memo 浅比较基础）；随 projection 快照重建
  const timeline = useMemo(
    () => (projection !== undefined ? mapProjectionTimeline(projection, "Novel 助理") : []),
    [projection],
  );
  const failed = projection?.state === "error";
  const runtime = useConversationRuntimeStatus(projection);

  // 排队幽灵项：生成/审批进行中再发送 → 消息要等上一 run 收口才实际执行
  // （run-start/user.message 在执行时才发射）——本地数组即时回显到时间线末尾；
  // 真实 user 项出现 N 条（排队 run 开跑）即移除队首 N 条，失败按 id 回收。
  const [queuedSends, setQueuedSends] = useState<readonly { id: number; text: string; at: number }[]>([]);
  const queuedSeqRef = useRef(0);

  // composer 实际高度 → 时间线底部预留（悬浮框盖不住末条消息）：状态行展开、
  // 输入增高都会变，ResizeObserver 实测回填（缺省 132px 由 CSS 回落）
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const node = composerRef.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setComposerHeight(node.offsetHeight);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const bottomReserve = composerHeight !== undefined ? composerHeight + 16 : undefined;
  const projectionUserCount =
    projection?.timeline.reduce((count, item) => (item.kind === "user" ? count + 1 : count), 0) ?? 0;
  const queuedTrackRef = useRef({ id: conversationId, userCount: projectionUserCount });
  useEffect(() => {
    const track = queuedTrackRef.current;
    if (track.id === conversationId && track.userCount === projectionUserCount) return;
    const switched = track.id !== conversationId;
    const appeared = switched ? 0 : Math.max(0, projectionUserCount - track.userCount);
    queuedTrackRef.current = { id: conversationId, userCount: projectionUserCount };
    setQueuedSends((current) => (switched ? [] : current.slice(appeared)));
  }, [conversationId, projectionUserCount]);
  const queuedCount = queuedSends.length;
  // 时间线末尾拼接幽灵项（sequence 本地合成，不与 core 事件序号冲突）
  const timelineWithGhosts = useMemo(
    () => [
      ...timeline,
      ...queuedSends.map((queued) => ({
        kind: "queued" as const,
        sequence: 9_000_000 + queued.id,
        text: queued.text,
        queuedAt: queued.at,
      })),
    ],
    [timeline, queuedSends],
  );

  // 三态推导（对齐旧版优先级）：failed > waiting（待审批，CMS 队列派生）> generating。
  // thinking 态已随 loop 层丢弃 reasoning delta 移除；waiting 复用 GenStatus 沙漏+摇摆动画。
  // waiting + 唤起回调 → 状态行升级为可点胶囊（点击打开审批弹窗）。
  let status: GenStatusProps | undefined;
  if (failed) {
    status = {
      phase: "failed",
      error: describeProjectionError(projection?.error),
      onRetry: () => void resume(),
    };
  } else if (pendingApprovalCount > 0) {
    status = {
      phase: "waiting",
      queuedCount,
      ...(onSummonApproval !== undefined
        ? { onWaitingClick: () => onSummonApproval() }
        : {}),
    };
  } else if (projection?.liveState === "generating") {
    status = { phase: "generating", queuedCount };
  } else if (queuedCount > 0) {
    // 不在生成但仍有排队（刚收口、排队 run 即将接续）：保持可见直到 user 项出现
    status = { phase: "waiting", queuedCount };
  }

  // 挂起提示条：有待决且弹窗未开时常驻顶部（demo .apAlertBar）
  const showApprovalBar =
    pendingApprovalCount > 0 && !approvalModalOpen && onSummonApproval !== undefined;

  return (
    <div className={styles.surface}>
      <MainSubHead
        title={title}
        sub={agentLabel}
        actions={
          <>
            <IconButton label={pinned ? "取消置顶" : "置顶会话"} onClick={onTogglePin}>
              <Icon icon={Pin} size="sm" />
            </IconButton>
            <Dropdown
              trigger={
                <IconButton label="会话菜单">
                  <Icon icon={MoreHorizontal} size="sm" />
                </IconButton>
              }
            >
              <DropdownItem
                label="重命名对话"
                icon={<Pencil size={14} />}
                onSelect={() => {
                  setRenameValue(title);
                  setRenameTarget({ id: conversationId, title });
                }}
              />
              {onOpenInfo !== undefined ? (
                <DropdownItem label="会话信息" icon={<Info size={14} />} onSelect={onOpenInfo} />
              ) : null}
              <DropdownSeparator />
              <DropdownItem
                label="删除对话"
                danger
                icon={<Trash2 size={14} />}
                onSelect={() => setDeleteTarget(conversationId)}
              />
            </Dropdown>
          </>
        }
      />
      {showApprovalBar ? (
        <ApprovalPendingBar count={pendingApprovalCount} onSummon={() => onSummonApproval?.()} />
      ) : null}
      <ConversationTimeline
        conversationId={conversationId}
        items={timelineWithGhosts}
        streamingSequence={projection?.lastAppliedSequence ?? 0}
        bottomReserve={bottomReserve}
        onMessageReferenceClick={onReferenceClick}
        resolveReference={resolveReference}
        onNotify={onNotify}
        onOpenApproval={onSummonApproval}
      />
      {sendError !== undefined && (
        <div className={styles.sendError} role="alert">
          {sendError}
        </div>
      )}
      <ConversationComposer
        conversationId={conversationId}
        containerRef={composerRef}
        enabled={snapshot?.state === "active" && !failed}
        status={status}
        sendDisabled={pendingApprovalCount > 0}
        disconnected={runtime.state === "disconnected"}
        mode={mode}
        pendingMode={pendingMode}
        onModeChange={(next) => {
          // 无乐观本地回显：mode.pending 事件回显「待生效」，mode.changed 落 active
          void sendSystemControl({ type: "mode.set", mode: next }).catch(() => {
            onNotify?.("danger", "模式切换失败，请重试");
          });
        }}
        onSend={(input) => {
          // 发送失败（会话进程崩溃/超时等）必须显性展示，不吞掉
          debugLog("[renderer] onSend 触发:", input.text.slice(0, 40));
          // 生成/审批中发送 → 立即入队幽灵项（demo 方案 A：不等回执/时间线出现）
          const queued = status?.phase === "generating" || status?.phase === "waiting";
          const queuedId = ++queuedSeqRef.current;
          if (queued) setQueuedSends((current) => [...current, { id: queuedId, text: input.text, at: Date.now() }]);
          void sendUserMessage(input.text)
            .then((receipt) => {
              debugLog("[renderer] send resolved:", JSON.stringify(receipt));
              setSendError(undefined);
              // 发送成功 = 会话有活动：本地刷新，驱动侧栏「今天」分组即时生效
              catalog.touchActivity(conversationId);
            })
            .catch((err: unknown) => {
              debugLog("[renderer] send rejected:", err);
              if (queued) setQueuedSends((current) => current.filter((item) => item.id !== queuedId));
              if (err instanceof Error && err.stack !== undefined) {
                console.error("[renderer] stack:", err.stack.split("\n").slice(0, 6).join(" | "));
              }
              const text = describeSendError(err);
              setSendError(text);
              onNotify?.("danger", text);
            });
        }}
      />
      <ConversationDialogs
        renameTarget={renameTarget}
        deleteTarget={deleteTarget}
        renameValue={renameValue}
        deleteBusy={deleteBusy}
        onRenameValueChange={setRenameValue}
        onRenameConfirm={() => {
          if (renameTarget === undefined) return;
          const next = renameValue.trim();
          if (next !== "") {
            void catalog.renameConversation(renameTarget.id, next).catch(() => {
              onNotify?.("danger", "重命名失败，请重试");
            });
          }
          closeDialogs();
        }}
        onDeleteConfirm={async () => {
          if (deleteTarget === undefined) return;
          const target = deleteTarget;
          setDeleteBusy(true);
          try {
            await catalog.deleteConversation(target);
            onNotify?.("success", "会话已删除");
          } catch {
            onNotify?.("danger", "删除失败，请重试");
          } finally {
            setDeleteBusy(false);
            closeDialogs();
          }
        }}
        onClose={closeDialogs}
      />
    </div>
  );
}

/** 投影错误 → GenStatus failed 文案（transport 类可重试） */
function describeProjectionError(error: ConversationProjectionErrorSnapshot | undefined): string {
  if (error === undefined) return "会话连接异常，请重试";
  switch (error.code) {
    case "peer-closed":
    case "timeout":
    case "cancelled":
      return "会话进程已退出，请重试";
    case "remote":
      return "会话处理失败，请重试";
    default:
      return "未知错误，请重试";
  }
}

/** 发送失败错误 → 用户可读文案（RPCError code 判别；子进程崩溃表现为 peer-closed/write 失败） */
function describeSendError(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "peer-closed") return "会话进程已退出，请重新打开会话继续";
  if (code === "timeout") return "会话响应超时，请重试";
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("stream was destroyed")) return "会话进程已退出，请重新打开会话继续";
  return `发送失败：${message}`;
}
