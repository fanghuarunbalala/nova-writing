/** Static top-level application menu presentation. */
export interface TopMenuProps {
  readonly onSelect?: (item: TopMenuItem) => void;
}

export type TopMenuItem = "project" | "edit" | "publish" | "help";

const MENU_ITEMS: readonly { readonly id: TopMenuItem; readonly label: string }[] =
  Object.freeze([
    Object.freeze({ id: "project", label: "项目" }),
    Object.freeze({ id: "edit", label: "编辑" }),
    Object.freeze({ id: "publish", label: "发布" }),
    Object.freeze({ id: "help", label: "帮助" }),
  ]);

export function TopMenu({ onSelect }: TopMenuProps) {
  return (
    <nav className="novel-top-menu" aria-label="应用菜单">
      {MENU_ITEMS.map((item) => (
        <button
          className="novel-menu-button"
          key={item.id}
          type="button"
          onClick={() => onSelect?.(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
