/**
 * ConversationItemMenu
 *
 * 对话项 ⋯ 菜单（原型 .conv-more + .conv-menu）：右侧绝对定位的 ⋯ 按钮，
 * 点击展开下拉菜单（重命名/置顶/删除）。
 *
 * conv-more 20x20 始终可见（faint 色），hover 时显示 surface-2 背景，
 * pinned 行默认 accent-ink；菜单用 Dropdown 组件渲染到 trigger 下方。
 *
 * 删除仅上报 onDelete；确认对话框由父级（ConversationListSection）渲染
 * 自定义 Dialog（原生 window.confirm 在 Electron 中体验不一致）。
 */
import { Dropdown, DropdownItem, DropdownSeparator } from "../../../shared/primitives/Dropdown.js";
import { Pencil, Pin, Trash2 } from "lucide-react";
import styles from "./ConversationItemMenu.module.css";

export interface ConversationItemMenuProps {
  readonly conversationId: string;
  readonly pinned?: boolean;
  readonly onRename?: (id: string) => void;
  readonly onPin?: (id: string, pinned: boolean) => void;
  readonly onDelete?: (id: string) => void;
}

export function ConversationItemMenu({
  conversationId,
  pinned = false,
  onRename,
  onPin,
  onDelete,
}: ConversationItemMenuProps) {
  return (
    <div className={styles.wrap}>
      <Dropdown
        trigger={
          <button type="button" className={styles.more} aria-label="对话操作" aria-haspopup="menu">
            <span aria-hidden="true">⋯</span>
          </button>
        }
      >
        {onRename !== undefined ? (
          <DropdownItem label="重命名" icon={<Pencil size={14} />} onSelect={() => onRename(conversationId)} />
        ) : null}
        {onPin !== undefined ? (
          <DropdownItem
            label={pinned ? "取消置顶" : "置顶"}
            icon={<Pin size={14} />}
            onSelect={() => onPin(conversationId, !pinned)}
          />
        ) : null}
        {onRename !== undefined || onPin !== undefined ? <DropdownSeparator /> : null}
        {onDelete !== undefined ? (
          <DropdownItem
            label="删除"
            danger
            icon={<Trash2 size={14} />}
            onSelect={() => onDelete(conversationId)}
          />
        ) : null}
      </Dropdown>
    </div>
  );
}
