/**
 * TopBar
 *
 * 顶栏（对齐原型）：侧栏切换 + wordmark + workspace 名/副标 + 右侧
 * 计划/审批/Workspace/设置动作 + 修订号。
 */
import { CalendarClock, FolderOpen, PanelLeft, Settings } from "lucide-react";
import { Icon } from "../../shared/primitives/Icon.js";
import { IconButton } from "../../shared/primitives/IconButton.js";
import type { MainViewState } from "../../shared/routing/MainViewRouter.js";
import { TopBarAction } from "./TopBarAction.js";
import { TopBarRevisionMeta } from "./TopBarRevisionMeta.js";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  readonly mainViewState: MainViewState;
  readonly onMainViewChange: (state: MainViewState) => void;
  readonly workspaceName?: string;
  readonly workspaceSub?: string;
  readonly revision?: string;
  readonly sidebarMode: "expanded" | "collapsed";
  readonly onToggleSidebar: () => void;
  readonly onOpenWorkspace: () => void;
  readonly onOpenSettings: () => void;
  readonly approvalCount?: number;
}

export function TopBar({
  mainViewState,
  onMainViewChange,
  workspaceName,
  workspaceSub,
  revision,
  sidebarMode,
  onToggleSidebar,
  onOpenWorkspace,
  onOpenSettings,
  approvalCount = 0,
}: TopBarProps) {
  return (
    <header className={styles.topbar}>
      <IconButton label={sidebarMode === "expanded" ? "收起侧栏" : "展开侧栏"} onClick={onToggleSidebar}>
        <Icon icon={PanelLeft} size="sm" />
      </IconButton>
      <span className={styles.wordmark}>Novel</span>
      {workspaceName !== undefined ? (
        <button type="button" className={styles.wsName} onClick={onOpenWorkspace} title={workspaceName}>
          {workspaceName}
        </button>
      ) : null}
      {workspaceSub !== undefined ? <span className={styles.wsSub}>{workspaceSub}</span> : null}
      <span className={styles.spacer} />
      <TopBarAction
        label="计划"
        icon={<Icon icon={CalendarClock} size="sm" />}
        active={mainViewState === "schedule"}
        onClick={() => onMainViewChange("schedule")}
      />
      <TopBarAction
        label="审批"
        badge={approvalCount}
        title="审批（待定）"
        onClick={() => undefined}
      />
      <TopBarRevisionMeta revision={revision} />
      <span className={styles.spacer} />
      <TopBarAction label="Workspace" icon={<Icon icon={FolderOpen} size="sm" />} onClick={onOpenWorkspace} />
      <TopBarAction label="设置" icon={<Icon icon={Settings} size="sm" />} onClick={onOpenSettings} />
    </header>
  );
}
