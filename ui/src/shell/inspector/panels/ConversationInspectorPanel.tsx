/**
 * ConversationInspectorPanel
 *
 * 对话元信息面板（inspector 用）：标题 + 元数据列表（Agent / ID）。
 */
import type { ConversationCatalogStore } from "../../../domains/conversation/store/ConversationCatalogStore.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import styles from "./ConversationInspectorPanel.module.css";

export interface ConversationInspectorPanelProps {
  readonly conversationId: string;
  readonly conversationCatalog: ConversationCatalogStore;
}

export function ConversationInspectorPanel({
  conversationId,
  conversationCatalog,
}: ConversationInspectorPanelProps) {
  const snapshot = useExternalStore(conversationCatalog);
  const item = snapshot.conversations.find((conversation) => conversation.id === conversationId);
  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>{item?.title ?? conversationId}</h3>
      <div className={styles.dMeta}>{conversationId}</div>
      <dl className={styles.meta}>
        <div>
          <dt>Agent</dt>
          <dd>{item?.agentLabel ?? "-"}</dd>
        </div>
      </dl>
    </div>
  );
}
