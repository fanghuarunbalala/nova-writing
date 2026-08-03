/** Compact shared button for expanding or collapsing project navigation. */
import type { SidebarMode } from "../state/index.js";

export interface SidebarToggleButtonProps {
  readonly mode: SidebarMode;
  readonly onToggle?: () => void;
  readonly className?: string;
}

export function SidebarToggleButton({
  mode,
  onToggle,
  className = "novel-sidebar-toggle",
}: SidebarToggleButtonProps) {
  const label = mode === "expanded" ? "收起侧边栏" : "展开侧边栏";
  return (
    <button
      aria-label={label}
      className={className}
      onClick={onToggle}
      title={label}
      type="button"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <rect height="14" rx="2" width="16" x="2" y="3" />
        <path d="M7 3v14" />
        <path d={mode === "expanded" ? "m5 8-2 2 2 2" : "m4 8 2 2-2 2"} />
      </svg>
    </button>
  );
}
