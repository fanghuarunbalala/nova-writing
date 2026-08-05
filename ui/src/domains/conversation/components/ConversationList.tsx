/**
 * ConversationList
 *
 * 对话列表容器：新建按钮 + 列表项。
 */
import {
  ConversationListItem,
  type ConversationListItemData,
} from "./ConversationListItem.js";
import { NewConversationButton } from "./NewConversationButton.js";
import styles from "./ConversationList.module.css";

export interface ConversationListProps {
  readonly conversations: readonly ConversationListItemData[];
  readonly activeId?: string;
  readonly onSelect: (id: string) => void;
  readonly onCreate?: () => void;
  readonly onRename?: (id: string) => void;
  readonly onPin?: (id: string, pinned: boolean) => void;
  readonly onDelete?: (id: string) => void;
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onPin,
  onDelete,
}: ConversationListProps) {
  return (
    <div className={styles.list}>
      {onCreate !== undefined ? <NewConversationButton onClick={onCreate} /> : null}
      {conversations.map((item) => (
        <ConversationListItem
          key={item.id}
          item={item}
          active={item.id === activeId}
          onSelect={onSelect}
          onRename={onRename}
          onPin={onPin}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
