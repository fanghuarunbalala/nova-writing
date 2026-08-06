/**
 * ConversationListItem
 *
 * 侧栏对话行（原型 .conv-row + .conv-item + .conv-status + .conv-more）。
 *
 * conv-row 为 relative 容器；conv-item 是主按钮（padding 8/30，左右 30px 留给
 * status + more）；conv-status 在左侧绝对定位（generating/failed 时显示 spinner）；
 * conv-more 在右侧绝对定位（始终可见，faint 色）。
 *
 * .conv-row / .pinned 同时作为 :global 全局类名，供 ConversationItemMenu.module.css
 * 跨文件定位 .more 的 pinned 高亮（CSS Modules 默认按文件作用域隔离，跨文件
 * 选择器需借助 :global）。
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

const STATUS_LABEL: Record<"generating" | "failed", string> = {
  generating: "生成中",
  failed: "失败",
};

export function ConversationListItem({
  item,
  active,
  onSelect,
  onRename,
  onPin,
  onDelete,
}: ConversationListItemProps) {
  const statusLabel = item.status !== undefined ? STATUS_LABEL[item.status] : undefined;
  return (
    <div
      className={[
        "conv-row",
        styles.row,
        active ? styles.active : "",
        item.status !== undefined ? styles[item.status] : "",
        item.pinned ? "pinned" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // 全局 conv-row/pinned 类名供 ConversationItemMenu.module.css 跨文件定位
      data-conv={item.id}
    >
      <span
        className={styles.status}
        aria-hidden={statusLabel === undefined ? true : undefined}
        aria-label={statusLabel}
      >
        <span className={styles.spinner} />
      </span>
      <button type="button" className={styles.main} onClick={() => onSelect(item.id)}>
        <span className={styles.title}>
          {item.title}
          {item.pinned ? <span className={styles.pinTag}>置顶</span> : null}
        </span>
        <span className={styles.sub}>
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
