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
        lastActivityAt: 0, // catalog 快照暂无时间戳；Phase 2 契约扩展后补齐
        ...(item.status === undefined ? {} : { status: item.status }),
      }))}
      activeId={snapshot.activeConversationId}
      onSelect={onSelect}
    />
  );
}
