/**
 * ChatSurface
 *
 * 组合对话域：timeline + composer；无对话时渲染空态。
 * 发送经 core UserMessageInputEvent enqueue（投影 binding）；
 * 生成状态（GenStatus）按原型置于 composer 输入框上方，live 时停止按钮 enqueue StopInputEvent。
 */
import {
  ApprovalDecisionInputEvent,
  StopInputEvent,
  UserMessageInputEvent,
  type Logger,
  type NovelApiClient,
} from "@novel/core";
import { useEffect, useMemo } from "react";
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
import {
  mapApprovalViews,
  type ApprovalStore,
} from "../../domains/approval/ApprovalStore.js";
import { MainSubHead } from "./MainSubHead.js";
import { mapProjectionTimeline } from "./chatSurfaceMapper.js";
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
  readonly approvalStore: ApprovalStore;
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
  approvalStore,
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
      title={catalog.conversations.find((item) => item.id === activeId)?.title ?? "对话"}
      agentLabel={catalog.conversations.find((item) => item.id === activeId)?.agentLabel ?? ""}
      onReferenceClick={onReferenceClick}
      resolveReference={resolveReference}
      onProposalAction={onProposalAction}
      onOpenApproval={onOpenApproval}
      approvalStore={approvalStore}
    />
  );
}

interface ActiveChatSurfaceProps {
  readonly api: NovelApiClient;
  readonly logger?: Logger;
  readonly conversationId: string;
  readonly title: string;
  readonly agentLabel: string;
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly onProposalAction?: (
    changeSetId: string,
    action: "approve" | "reject" | "view-diff",
  ) => void;
  readonly onOpenApproval?: (approvalRequestId: string) => void;
  readonly approvalStore: ApprovalStore;
}

function ActiveChatSurface({
  api,
  logger,
  conversationId,
  title,
  agentLabel,
  onReferenceClick,
  resolveReference,
  onProposalAction,
  onOpenApproval,
  approvalStore,
}: ActiveChatSurfaceProps) {
  const { snapshot, enqueue, resume } = useConversationProjection(conversationId, {
    api,
    logger,
  });
  // 同步投影里的工具审批到 shell 级 ApprovalStore（InspectorHost/TopBar 订阅）。
  useEffect(() => {
    approvalStore.setApprovals(mapApprovalViews(snapshot.projection.approvals));
  }, [approvalStore, snapshot.projection.approvals]);
  // 决策回调：InspectorHost 的批准/拒绝最终走 binding enqueue 决策输入事件。
  useEffect(() => {
    approvalStore.setDecisionHandler(
      (approvalRequestId, decision, argumentDigest) =>
        enqueue(
          new ApprovalDecisionInputEvent({
            conversationId,
            approvalRequestId,
            decision,
            argumentDigest,
          }),
        ),
    );
    return () => approvalStore.setDecisionHandler(undefined);
  }, [approvalStore, conversationId, enqueue]);
  const timeline = mapProjectionTimeline(
    snapshot.projection,
    snapshot.cards.cards,
    "Novel Agent",
  );
  const runtimeStatus = useConversationRuntimeStatus(snapshot.projection);
  const failed = runtimeStatus.state === "failed";
  const genPhase = failed
    ? "failed"
    : runtimeStatus.state === "live"
      ? "streaming"
      : "idle";
  const genStatus: GenStatusProps | undefined =
    genPhase === "idle"
      ? undefined
      : {
          phase: genPhase,
          error: failed ? "会话运行不可用，消息未送达。" : undefined,
          onRetry: failed ? () => { void resume(); } : undefined,
          onStop: !failed ? () => { void enqueue(new StopInputEvent({ conversationId })); } : undefined,
        };
  return (
    <div className={styles.surface}>
      <MainSubHead title={title} sub={agentLabel} />
      <ConversationTimeline
        conversationId={conversationId}
        items={timeline}
        streamingSequence={snapshot.projection.lastAppliedSequence}
        onMessageReferenceClick={onReferenceClick}
        resolveReference={resolveReference}
        onProposalAction={onProposalAction}
        onOpenApproval={onOpenApproval}
        onApprovalDecision={(approvalRequestId, decision) => {
          void approvalStore.decide(approvalRequestId, decision);
        }}
      />
      <ConversationComposer
        conversationId={conversationId}
        enabled={snapshot.state === "active" && !failed}
        status={genStatus}
        onSend={(input) => {
          void enqueue(new UserMessageInputEvent({ conversationId, text: input.text }));
        }}
      />
    </div>
  );
}
