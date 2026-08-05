/**
 * ConversationListItem
 *
 * 侧栏对话行：标题 + agent + 时间 + 状态指示 + ⋯ 菜单。
 */
import { ConversationItemMenu } from "./ConversationItemMenu.js";
import styles from "./ConversationListItem.module.css";

export interface ConversationListItemData {
  readonly id: string;
  readonly title: string;
  readonly agentLabel: string;
  readonly lastActivityAt: number;
  readonly status?: "generating" | "failed";
  readonly pinned?: boolean;
}

export interface ConversationListItemProps {
  readonly item: ConversationListItemData;
  readonly active: boolean;
  readonly onSelect: (id: string) => void;
  readonly onRename?: (id: string) => void;
  readonly onPin?: (id: string, pinned: boolean) => void;
  readonly onDelete?: (id: string) => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ConversationListItem({
  item,
  active,
  onSelect,
  onRename,
  onPin,
  onDelete,
}: ConversationListItemProps) {
  return (
    <div
      className={[styles.row, active ? styles.active : ""].filter(Boolean).join(" ")}
      data-conv={item.id}
    >
      <button type="button" className={styles.main} onClick={() => onSelect(item.id)}>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.sub}>
          {item.status === "generating" ? <span className={styles.generating} aria-label="生成中" /> : null}
          {item.status === "failed" ? <span className={styles.failed} aria-label="失败" /> : null}
          <span className={styles.agent}>{item.agentLabel}</span>
          <time className={styles.time}>{formatTime(item.lastActivityAt)}</time>
        </span>
      </button>
      <ConversationItemMenu
        conversationId={item.id}
        pinned={item.pinned}
        onRename={onRename}
        onPin={onPin}
        onDelete={onDelete}
      />
    </div>
  );
}
