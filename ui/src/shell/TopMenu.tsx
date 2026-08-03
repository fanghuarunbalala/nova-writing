/** Top-level application menu with Workspace and Settings commands. */
import { useState } from "react";
import type { SidebarMode } from "../state/index.js";
import { SidebarToggleButton } from "./SidebarToggleButton.js";

export interface TopMenuProps {
  readonly onSelect?: (item: TopMenuItem) => void;
  readonly onOpenWorkspace?: () => void;
  readonly onCloseWorkspace?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onToggleSidebar?: () => void;
  readonly workspaceOpen?: boolean;
  readonly sidebarMode?: SidebarMode;
}

export type TopMenuItem = "project" | "edit" | "publish" | "help";

const MENU_ITEMS: readonly { readonly id: TopMenuItem; readonly label: string }[] =
  Object.freeze([
    Object.freeze({ id: "project", label: "项目" }),
    Object.freeze({ id: "edit", label: "编辑" }),
    Object.freeze({ id: "publish", label: "发布" }),
    Object.freeze({ id: "help", label: "帮助" }),
  ]);

export function TopMenu({
  onSelect,
  onOpenWorkspace,
  onCloseWorkspace,
  onOpenSettings,
  onToggleSidebar,
  workspaceOpen = false,
  sidebarMode = "expanded",
}: TopMenuProps) {
  const [openMenu, setOpenMenu] = useState<TopMenuItem | undefined>();
  const selectMenu = (item: TopMenuItem): void => {
    if (item === "project" || item === "edit") {
      setOpenMenu((current) => (current === item ? undefined : item));
      return;
    }
    setOpenMenu(undefined);
    onSelect?.(item);
  };
  const execute = (command: (() => void) | undefined): void => {
    setOpenMenu(undefined);
    command?.();
  };
  return (
    <nav
      className="novel-top-menu"
      aria-label="应用菜单"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpenMenu(undefined);
      }}
    >
      {MENU_ITEMS.map((item) => (
        <button
          aria-expanded={
            item.id === "project" || item.id === "edit"
              ? openMenu === item.id
              : undefined
          }
          className="novel-menu-button"
          data-active={openMenu === item.id}
          key={item.id}
          type="button"
          onClick={() => selectMenu(item.id)}
        >
          {item.label}
        </button>
      ))}
      {openMenu === "project" ? (
        <div className="novel-menu-popover" data-menu="project" role="menu">
          <button onClick={() => execute(onOpenWorkspace)} role="menuitem" type="button">
            打开 Workspace…
          </button>
          <button
            disabled={!workspaceOpen}
            onClick={() => execute(onCloseWorkspace)}
            role="menuitem"
            type="button"
          >
            关闭 Workspace
          </button>
        </div>
      ) : null}
      {openMenu === "edit" ? (
        <div className="novel-menu-popover" data-menu="edit" role="menu">
          <button onClick={() => execute(onOpenSettings)} role="menuitem" type="button">
            设置…
          </button>
        </div>
      ) : null}
      <span className="novel-menu-spacer" />
      <SidebarToggleButton mode={sidebarMode} onToggle={onToggleSidebar} />
    </nav>
  );
}
