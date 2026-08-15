/**
 * ConversationListItem
 *
 * 侧栏对话行（对齐 app-redesign demo 的 convItem）：
 * [图标位 26px（accent 底 + message 图标；generating/failed/unavailable 时被
 *  状态 spinner 覆盖）] [标题（+置顶小图标）/ 副信息 agentLabel] [状态点?] [⋯ 菜单]
 *
 * .conv-row 为 relative 容器；状态覆盖层（.status）绝对定位于图标位上方，
 * conv-more（ConversationItemMenu）右侧绝对定位常驻。
 * .conv-row / .pinned 同时作为 :global 全局类名，供 ConversationItemMenu.module.css
 * 跨文件定位 .more 的 pinned 高亮（CSS Modules 默认按文件作用域隔离，跨文件
 * 选择器需借助 :global）。
 */
import { memo } from "react";
import { MessageSquare, Pin } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import { ConversationItemMenu } from "./ConversationItemMenu.js";
import styles from "./ConversationListItem.module.css";

export interface ConversationListItemData {
  readonly id: string;
  readonly title: string;
  readonly agentLabel: string;
  readonly lastActivityAt: number;
  readonly status?: "generating" | "failed" | "unavailable";
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

const STATUS_LABEL: Record<"generating" | "failed" | "unavailable", string> = {
  generating: "生成中",
  failed: "失败",
  unavailable: "不可用",
};

/** 侧栏对话行（memo：item 身份稳定 + 回调 useCallback → 列表刷新只渲染变更行） */
export const ConversationListItem = memo(function ConversationListItem({
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
      {/* 状态覆盖层：generating/failed/unavailable 时以 spinner 覆盖图标位 */}
      <span
        className={styles.status}
        aria-hidden={statusLabel === undefined ? true : undefined}
        aria-label={statusLabel}
      >
        <span className={styles.spinner} />
      </span>
      <button type="button" className={styles.main} onClick={() => onSelect(item.id)}>
        <span className={styles.iconBox} aria-hidden="true">
          <Icon icon={MessageSquare} size="xs" />
        </span>
        <span className={styles.text}>
          <span className={styles.title}>
            <span className={styles.titleText}>{item.title}</span>
            {item.pinned ? (
              <span className={styles.pinTag} aria-label="已置顶">
                <Icon icon={Pin} size="xs" />
              </span>
            ) : null}
          </span>
          <span className={styles.subtitle}>{item.agentLabel}</span>
        </span>
      </button>
      {item.status !== undefined ? (
        <span
          className={`${styles.dot} ${styles[`dot-${item.status}`] ?? ""}`}
          aria-hidden="true"
        />
      ) : null}
      <ConversationItemMenu
        conversationId={item.id}
        pinned={item.pinned}
        onRename={onRename}
        onPin={onPin}
        onDelete={onDelete}
      />
    </div>
  );
});
