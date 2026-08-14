/**
 * ChatSurface
 *
 * 组合对话域：timeline + composer；无对话时渲染空态。
 * 精简版：session 由 shell 级 hook（useActiveConversationSession）单订阅注入，
 * 发送经 sendUserMessage，时间线由精简投影映射；thinking/runtime-status/cards 延后。
 */
import { useEffect, useState } from "react";
import type { ConversationMode } from "@novel/core";
import type { ConversationProjectionErrorSnapshot } from "@novel/core/client";
import type { ToastKind } from "../../shared/state/ToastStore.js";
import { ChatEmptyState } from "../../domains/conversation/components/ChatEmptyState.js";
import { ConversationComposer } from "../../domains/conversation/components/ConversationComposer.js";
import { ConversationTimeline } from "../../domains/conversation/components/ConversationTimeline.js";
import type { GenStatusProps } from "../../domains/conversation/components/GenStatus.js";
import type { MessageReference } from "../../domains/conversation/components/MessageReference.js";
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import type { ReferenceResolver } from "../../domains/conversation/reference/ReferenceResolver.js";
import type { ActiveConversationSession } from "../../domains/conversation/hooks/useActiveConversationSession.js";
import { useConversationRuntimeStatus } from "../../domains/conversation/hooks/useConversationRuntimeStatus.js";
import { mapProjectionTimeline } from "./chatSurfaceMapper.js";
import styles from "./ChatSurface.module.css";

export interface ChatSurfaceProps {
  readonly session: ActiveConversationSession;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly onCreateConversation: () => void;
  /** 本会话待审批数（CMS wait 队列派生；>0 时 composer 等待态） */
  readonly pendingApprovalCount?: number;
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

export function ChatSurface({
  session,
  conversationCatalog,
  onCreateConversation,
  pendingApprovalCount = 0,
  onReferenceClick,
  resolveReference,
  onNotify,
}: ChatSurfaceProps) {
  const catalog = useExternalStore(conversationCatalog);
  const activeId = catalog.activeConversationId;
  if (activeId === undefined) {
    return <ChatEmptyState onCreate={onCreateConversation} />;
  }
  return (
    <ActiveChatSurface
      session={session}
      conversationId={activeId}
      title={catalog.conversations.find((item) => item.id === activeId)?.title ?? "对话"}
      pendingApprovalCount={pendingApprovalCount}
      onReferenceClick={onReferenceClick}
      resolveReference={resolveReference}
      onNotify={onNotify}
    />
  );
}

interface ActiveChatSurfaceProps {
  readonly session: ActiveConversationSession;
  readonly conversationId: string;
  readonly title: string;
  readonly pendingApprovalCount: number;
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

function ActiveChatSurface({
  session,
  conversationId,
  pendingApprovalCount,
  onReferenceClick,
  resolveReference,
  onNotify,
}: ActiveChatSurfaceProps) {
  const { snapshot, sendUserMessage, sendSystemControl, getConversationMode, resume } = session;
  const [sendError, setSendError] = useState<string | undefined>(undefined);
  // 会话模式：启动时查询（mode.set 待下次 turn 生效；切换后本地即时显示）
  const [mode, setMode] = useState<ConversationMode>("review");
  useEffect(() => {
    let cancelled = false;
    void getConversationMode()
      .then((current) => {
        if (!cancelled) setMode(current);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [conversationId, getConversationMode]);
  const projection = snapshot?.projection;
  const timeline =
    projection !== undefined ? mapProjectionTimeline(projection, "Novel Agent") : [];
  const failed = projection?.state === "error";
  const runtime = useConversationRuntimeStatus(projection);

  // 三态推导（对齐旧版优先级）：failed > waiting（待审批，CMS 队列派生）> thinking > generating。
  // waiting 态复用 GenStatus 沙漏+摇摆动画（审批面板由 ApplicationShell 自动弹出）。
  let status: GenStatusProps | undefined;
  if (failed) {
    status = {
      phase: "failed",
      error: describeProjectionError(projection?.error),
      onRetry: () => void resume(),
    };
  } else if (pendingApprovalCount > 0) {
    status = { phase: "waiting" };
  } else if (projection?.liveState === "thinking") {
    status = { phase: "thinking" };
  } else if (projection?.liveState === "generating") {
    status = { phase: "generating" };
  }

  return (
    <div className={styles.surface}>
      <ConversationTimeline
        conversationId={conversationId}
        items={timeline}
        streamingSequence={projection?.lastAppliedSequence ?? 0}
        onMessageReferenceClick={onReferenceClick}
        resolveReference={resolveReference}
        onNotify={onNotify}
      />
      {sendError !== undefined && (
        <div className={styles.sendError} role="alert">
          {sendError}
        </div>
      )}
      <ConversationComposer
        conversationId={conversationId}
        enabled={snapshot?.state === "active" && !failed}
        status={status}
        sendDisabled={pendingApprovalCount > 0}
        disconnected={runtime.state === "disconnected"}
        mode={mode}
        onModeChange={(next) => {
          setMode(next);
          void sendSystemControl({ type: "mode.set", mode: next }).catch(() => {
            onNotify?.("danger", "模式切换失败，请重试");
          });
        }}
        onSend={(input) => {
          // 发送失败（会话进程崩溃/超时等）必须显性展示，不吞掉
          void sendUserMessage(input.text)
            .then(() => setSendError(undefined))
            .catch((err: unknown) => {
              const text = describeSendError(err);
              setSendError(text);
              onNotify?.("danger", text);
            });
        }}
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
