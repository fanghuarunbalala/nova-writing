/**
 * ConversationItemMenu
 *
 * 对话项 ⋯ 菜单：重命名/置顶/删除（回调存在时启用）。
 */
import { Dropdown, DropdownItem, DropdownSeparator } from "../../../shared/primitives/Dropdown.js";
import { IconButton } from "../../../shared/primitives/IconButton.js";
import { MoreHorizontal, Pencil, Pin, Trash2 } from "lucide-react";
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
    <div className={styles.menu}>
      <Dropdown
        trigger={
          <IconButton label="对话操作" size="sm">
            <MoreHorizontal size={14} />
          </IconButton>
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
          <DropdownItem label="删除" danger icon={<Trash2 size={14} />} onSelect={() => onDelete(conversationId)} />
        ) : null}
      </Dropdown>
    </div>
  );
}
