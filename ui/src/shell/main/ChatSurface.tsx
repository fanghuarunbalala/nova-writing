/**
 * ChatSurface
 *
 * 组合对话域：timeline + composer；无对话时渲染空态。
 * 发送经 core UserMessageInputEvent enqueue（投影 binding）。
 */
import { UserMessageInputEvent, type Logger, type NovelApiClient } from "@novel/core";
import { ChatEmptyState } from "../../domains/conversation/components/ChatEmptyState.js";
import { ConversationComposer } from "../../domains/conversation/components/ConversationComposer.js";
import { ConversationTimeline } from "../../domains/conversation/components/ConversationTimeline.js";
import { useConversationProjection } from "../../domains/conversation/hooks/useConversationProjection.js";
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import { MainSubHead } from "./MainSubHead.js";
import { mapProjectionTimeline } from "./chatSurfaceMapper.js";
import styles from "./ChatSurface.module.css";

export interface ChatSurfaceProps {
  readonly api: NovelApiClient;
  readonly logger?: Logger;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly onCreateConversation: () => void;
}

export function ChatSurface({
  api,
  logger,
  conversationCatalog,
  onCreateConversation,
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
    />
  );
}

interface ActiveChatSurfaceProps {
  readonly api: NovelApiClient;
  readonly logger?: Logger;
  readonly conversationId: string;
  readonly title: string;
  readonly agentLabel: string;
}

function ActiveChatSurface({ api, logger, conversationId, title, agentLabel }: ActiveChatSurfaceProps) {
  const { snapshot, enqueue } = useConversationProjection(conversationId, { api, logger });
  const timeline = mapProjectionTimeline(snapshot.projection, "Novel Agent");
  return (
    <div className={styles.surface}>
      <MainSubHead title={title} sub={agentLabel} />
      <ConversationTimeline
        conversationId={conversationId}
        items={timeline}
        streamingSequence={snapshot.projection.lastAppliedSequence}
      />
      <ConversationComposer
        conversationId={conversationId}
        enabled={snapshot.state === "active"}
        onSend={(input) => {
          void enqueue(new UserMessageInputEvent({ conversationId, text: input.text }));
        }}
      />
    </div>
  );
}
