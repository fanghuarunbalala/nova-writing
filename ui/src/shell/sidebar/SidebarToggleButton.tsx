/**
 * SidebarToggleButton
 *
 * 侧栏折叠/展开按钮（底部）。
 */
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { Icon } from "../../shared/primitives/Icon.js";
import { IconButton } from "../../shared/primitives/IconButton.js";
import styles from "./SidebarToggleButton.module.css";

export interface SidebarToggleButtonProps {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}

export function SidebarToggleButton({ collapsed, onToggle }: SidebarToggleButtonProps) {
  return (
    <div className={styles.wrapper}>
      <IconButton label={collapsed ? "展开侧栏" : "收起侧栏"} size="sm" onClick={onToggle}>
        <Icon icon={collapsed ? ChevronsRight : ChevronsLeft} size="sm" />
      </IconButton>
    </div>
  );
}
