/**
 * ConversationListSection
 *
 * 对话列表 section：把 catalog 项映射为列表行。
 */
import { ConversationList } from "../../../domains/conversation/components/ConversationList.js";
import type { ConversationCatalogStore } from "../../../domains/conversation/store/ConversationCatalogStore.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import styles from "./ConversationListSection.module.css";

export interface ConversationListSectionProps {
  readonly store: ConversationCatalogStore;
  readonly onSelect: (id: string) => void;
}

export function ConversationListSection({ store, onSelect }: ConversationListSectionProps) {
  const snapshot = useExternalStore(store);
  if (snapshot.conversations.length === 0) {
    return <div className={styles.empty}>暂无对话 · 点击上方创建</div>;
  }
  return (
    <ConversationList
      conversations={snapshot.conversations.map((item) => ({
        id: item.id,
        title: item.title,
        agentLabel: item.agentLabel,
        lastActivityAt: item.lastActivityAt,
        ...(item.pinned === undefined ? {} : { pinned: item.pinned }),
        ...(item.status === undefined ? {} : { status: item.status }),
      }))}
      activeId={snapshot.activeConversationId}
      onSelect={onSelect}
      onRename={(id) => {
        const current =
          snapshot.conversations.find((item) => item.id === id)?.title ?? "";
        const next = window.prompt("重命名对话", current);
        if (next !== null && next.trim() !== "") {
          void store.renameConversation(id, next.trim());
        }
      }}
      onPin={(id, pinned) => {
        void store.pinConversation(id, pinned);
      }}
      onDelete={(id) => {
        void store.deleteConversation(id);
      }}
    />
  );
}
