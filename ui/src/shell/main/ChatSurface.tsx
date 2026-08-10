/**
 * ChatSurface
 *
 * 组合对话域：timeline + composer；无对话时渲染空态。
 * 发送经 core UserMessageInputEvent enqueue（投影 binding）；
 * 生成状态（GenStatus）按原型置于 composer 输入框上方，三态（思考/生成/等待审批）
 * 由最新 streaming 助手消息的 activeChannel 与挂起审批判定。
 */
import {
  ConversationModeSetInputEvent,
  UserMessageInputEvent,
  type AssistantMessageProjection,
  type Logger,
  type NovelApiClient,
} from "@novel/core";
import { useEffect, useMemo } from "react";
import type { ToastKind } from "../../shared/state/ToastStore.js";
import { ChatEmptyState } from "../../domains/conversation/components/ChatEmptyState.js";
import { ConversationComposer } from "../../domains/conversation/components/ConversationComposer.js";
import { ConversationTimeline } from "../../domains/conversation/components/ConversationTimeline.js";
import type { GenStatusProps } from "../../domains/conversation/components/GenStatus.js";
import type { MessageReference } from "../../domains/conversation/components/MessageReference.js";
import { useConversationProjection } from "../../domains/conversation/hooks/useConversationProjection.js";
import { useConversationRuntimeStatus } from "../../domains/conversation/hooks/useConversationRuntimeStatus.js";
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import type { ReferenceResolver } from "../../domains/conversation/reference/ReferenceResolver.js";
import type { ApprovalStore } from "../../domains/approval/ApprovalStore.js";
import { MainSubHead } from "./MainSubHead.js";
import { composeStatusLabel, mapProjectionTimeline } from "./chatSurfaceMapper.js";
import styles from "./ChatSurface.module.css";

export interface ChatSurfaceProps {
  readonly api: NovelApiClient;
  readonly logger?: Logger;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly onCreateConversation: () => void;
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly onProposalAction?: (
    changeSetId: string,
    action: "approve" | "reject" | "view-diff",
  ) => void;
  readonly onOpenApproval?: (approvalRequestId: string) => void;
  readonly onNotify?: (kind: ToastKind, text: string) => void;
  readonly approvalStore: ApprovalStore;
  /** 本会话审批变化回调（事件驱动全局审批刷新）。 */
  readonly onApprovalChange?: () => void;
}

export function ChatSurface({
  api,
  logger,
  conversationCatalog,
  onCreateConversation,
  onReferenceClick,
  resolveReference,
  onProposalAction,
  onOpenApproval,
  onNotify,
  approvalStore,
  onApprovalChange,
}: ChatSurfaceProps) {
  const catalog = useExternalStore(conversationCatalog);
  const activeId = catalog.activeConversationId;
  if (activeId === undefined) {
    return <ChatEmptyState onCreate={onCreateConversation} />;
  }
  return (
    <ActiveChatSurface
      api={api}
      logger={logger}
      conversationId={activeId}
      onApprovalChange={onApprovalChange}
      title={catalog.conversations.find((item) => item.id === activeId)?.title ?? "对话"}
      onReferenceClick={onReferenceClick}
      resolveReference={resolveReference}
      onProposalAction={onProposalAction}
      onOpenApproval={onOpenApproval}
      onNotify={onNotify}
      approvalStore={approvalStore}
    />
  );
}

interface ActiveChatSurfaceProps {
  readonly api: NovelApiClient;
  readonly logger?: Logger;
  readonly conversationId: string;
  readonly title: string;
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly onProposalAction?: (
    changeSetId: string,
    action: "approve" | "reject" | "view-diff",
  ) => void;
  readonly onOpenApproval?: (approvalRequestId: string) => void;
  readonly onNotify?: (kind: ToastKind, text: string) => void;
  readonly approvalStore: ApprovalStore;
  /** 本会话审批变化回调（事件驱动全局审批刷新）。 */
  readonly onApprovalChange?: () => void;
}

function ActiveChatSurface({
  api,
  logger,
  conversationId,
  title,
  onReferenceClick,
  resolveReference,
  onProposalAction,
  onOpenApproval,
  onNotify,
  approvalStore,
  onApprovalChange,
}: ActiveChatSurfaceProps) {
  const { snapshot, enqueue, resume } = useConversationProjection(conversationId, {
    api,
    logger,
    onApprovalChange,
  });
  // 审批数据与决策由 ApplicationShell 全局管理（跨会话）；此处仅保留
  // 消息流审批卡的批准/请求修改入口（approvalStore.decide）。
  const timeline = mapProjectionTimeline(
    snapshot.projection,
    snapshot.cards.cards,
    "Novel Agent",
  );
  const runtimeStatus = useConversationRuntimeStatus(snapshot.projection);
  const failed = runtimeStatus.state === "failed";
  // 本会话是否有挂起审批（审核中）：读本会话投影（双工，审批事件实时更新），
  // 仅禁用发送按钮，打字/切 mode 不受影响。
  const pendingApproval = (snapshot.projection.approvals ?? []).some(
    (approval) => approval.status === "pending",
  );
  // 三态判定：failed > waiting（审批挂起）> thinking（最后 delta 为 thinking channel）> generating。
  const live = runtimeStatus.state === "live";
  const latestStreaming = [...snapshot.projection.timeline]
    .reverse()
    .find(
      (item): item is AssistantMessageProjection =>
        item.kind === "assistant-message" && item.status === "streaming",
    );
  // 思考中：streaming 消息尚未产出任何正文（无论 thinking delta 分几块都持续到正文开始）。
  const thinking =
    live &&
    latestStreaming !== undefined &&
    !latestStreaming.content.some((part) => part.type === "text");
  let genPhase: GenStatusProps["phase"] | "idle";
  if (failed) genPhase = "failed";
  else if (pendingApproval) genPhase = "waiting";
  else if (live) genPhase = thinking ? "thinking" : "generating";
  else genPhase = "idle";
  const genStatus: GenStatusProps | undefined =
    genPhase === "idle"
      ? undefined
      : {
          phase: genPhase,
          error: failed ? "会话运行不可用，消息未送达。" : undefined,
          onRetry: failed ? () => { void resume(); } : undefined,
        };
  // mode 徽标读投影 composePhase（connect 播种 + 事件实时覆盖，裁剪后仍正确）。
  const composeBadge = composeStatusLabel(snapshot.projection);
  const mode = snapshot.projection.conversationMode ?? "review";
  return (
    <div className={styles.surface}>
      <MainSubHead
        title={title}
        actions={
          composeBadge === undefined ? undefined : (
            <span className={styles.composeBadge}>{composeBadge}</span>
          )
        }
      />
      <ConversationTimeline
        conversationId={conversationId}
        items={timeline}
        streamingSequence={snapshot.projection.lastAppliedSequence}
        onMessageReferenceClick={onReferenceClick}
        resolveReference={resolveReference}
        onProposalAction={onProposalAction}
        onOpenApproval={onOpenApproval}
        onNotify={onNotify}
        onApprovalDecision={(approvalRequestIds, decision) => {
          for (const approvalRequestId of approvalRequestIds) {
            void approvalStore.decide(approvalRequestId, decision);
          }
        }}
      />
      <ConversationComposer
        conversationId={conversationId}
        enabled={snapshot.state === "active" && !failed}
        sendDisabled={pendingApproval}
        status={genStatus}
        mode={mode}
        onModeChange={(next) => {
          // 会话级 mode 切换走既有 inputEnqueue 单通道（control lane），
          // core 持久化后以 novel.mode.changed 实时同步回投影。
          void enqueue(
            new ConversationModeSetInputEvent({ conversationId, mode: next }),
          );
        }}
        onSend={(input) => {
          void enqueue(new UserMessageInputEvent({ conversationId, text: input.text }));
        }}
      />
    </div>
  );
}
