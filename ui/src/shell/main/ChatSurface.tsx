/**
 * ChatSurface
 *
 * 组合对话域：timeline + composer；无对话时渲染空态。
 * 精简版：session 由 shell 级 hook（useActiveConversationSession）单订阅注入，
 * 发送经 sendUserMessage，时间线由精简投影映射；thinking/runtime-status/cards 延后。
 */
import { useState } from "react";
import type { ToastKind } from "../../shared/state/ToastStore.js";
import { ChatEmptyState } from "../../domains/conversation/components/ChatEmptyState.js";
import { ConversationComposer } from "../../domains/conversation/components/ConversationComposer.js";
import { ConversationTimeline } from "../../domains/conversation/components/ConversationTimeline.js";
import type { MessageReference } from "../../domains/conversation/components/MessageReference.js";
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import type { ReferenceResolver } from "../../domains/conversation/reference/ReferenceResolver.js";
import type { ActiveConversationSession } from "../../domains/conversation/hooks/useActiveConversationSession.js";
import { mapProjectionTimeline } from "./chatSurfaceMapper.js";
import styles from "./ChatSurface.module.css";

export interface ChatSurfaceProps {
  readonly session: ActiveConversationSession;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly onCreateConversation: () => void;
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

export function ChatSurface({
  session,
  conversationCatalog,
  onCreateConversation,
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
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

function ActiveChatSurface({
  session,
  conversationId,
  onReferenceClick,
  resolveReference,
  onNotify,
}: ActiveChatSurfaceProps) {
  const { snapshot, sendUserMessage } = session;
  const [sendError, setSendError] = useState<string | undefined>(undefined);
  const timeline = mapProjectionTimeline(snapshot?.projection.timeline ?? [], "Novel Agent");
  const failed = snapshot?.projection.state === "error";
  return (
    <div className={styles.surface}>
      <ConversationTimeline
        conversationId={conversationId}
        items={timeline}
        streamingSequence={snapshot?.projection.lastAppliedSequence ?? 0}
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

/** 发送失败错误 → 用户可读文案（RPCError code 判别；子进程崩溃表现为 peer-closed/write 失败） */
function describeSendError(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "peer-closed") return "会话进程已退出，请重新打开会话继续";
  if (code === "timeout") return "会话响应超时，请重试";
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("stream was destroyed")) return "会话进程已退出，请重新打开会话继续";
  return `发送失败：${message}`;
}
