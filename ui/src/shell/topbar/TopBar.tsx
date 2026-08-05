/**
 * TopBar
 *
 * 顶栏：workspace 标识 + 视图切换 + 右侧动作（侧栏/workspace/设置）。
 */
import { Settings, FolderOpen, PanelLeft } from "lucide-react";
import { Icon } from "../../shared/primitives/Icon.js";
import { IconButton } from "../../shared/primitives/IconButton.js";
import type { MainViewState } from "../../shared/routing/MainViewRouter.js";
import { TopBarAction } from "./TopBarAction.js";
import { TopBarRevisionMeta } from "./TopBarRevisionMeta.js";
import { TopBarViewSwitcher } from "./TopBarViewSwitcher.js";
import { TopBarWorkspaceLabel } from "./TopBarWorkspaceLabel.js";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  readonly mainViewState: MainViewState;
  readonly onMainViewChange: (state: MainViewState) => void;
  readonly workspaceLabel?: string;
  readonly revision?: string;
  readonly sidebarMode: "expanded" | "collapsed";
  readonly onToggleSidebar: () => void;
  readonly onOpenWorkspace: () => void;
  readonly onOpenSettings: () => void;
}

export function TopBar({
  mainViewState,
  onMainViewChange,
  workspaceLabel,
  revision,
  sidebarMode,
  onToggleSidebar,
  onOpenWorkspace,
  onOpenSettings,
}: TopBarProps) {
  return (
    <header className={styles.topbar}>
      <IconButton label={sidebarMode === "expanded" ? "收起侧栏" : "展开侧栏"} onClick={onToggleSidebar}>
        <Icon icon={PanelLeft} size="sm" />
      </IconButton>
      {workspaceLabel !== undefined ? (
        <TopBarWorkspaceLabel label={workspaceLabel} onClick={onOpenWorkspace} />
      ) : null}
      <TopBarRevisionMeta revision={revision} />
      <span className={styles.spacer} />
      <TopBarViewSwitcher state={mainViewState} onChange={onMainViewChange} />
      <span className={styles.spacer} />
      <TopBarAction label="Workspace" icon={<Icon icon={FolderOpen} size="sm" />} onClick={onOpenWorkspace} />
      <TopBarAction label="设置" icon={<Icon icon={Settings} size="sm" />} onClick={onOpenSettings} />
    </header>
  );
}
