/**
 * TopBar
 *
 * 顶栏（对齐原型）：侧栏切换 + wordmark + workspace 名/副标 + 右侧
 * Workspace/设置动作 + 修订号。右侧 TopBarAction 渲染 计划 动作，
 * 点击由 shell 路由到计划视图；审批入口已移除（待审批时右侧面板自动展开，
 * 见 ApplicationShell 的自动展开 effect）。
 * TopBarMenuSlot 渲染 extensions.titleBar 注入的桌面专属内容（spec 4.2）。
 */
import { memo } from "react";
import { FolderOpen, PanelLeft, Settings } from "lucide-react";
import { Icon } from "../../shared/primitives/Icon.js";
import { IconButton } from "../../shared/primitives/IconButton.js";
import type { NovelUiExtensions } from "../../extensions/NovelUiExtensions.js";
import { TopBarAction } from "./TopBarAction.js";
import { TopBarMenuSlot } from "./TopBarMenuSlot.js";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  readonly workspaceName?: string;
  readonly workspaceSub?: string;
  readonly sidebarMode: "expanded" | "collapsed";
  readonly onToggleSidebar: () => void;
  readonly onOpenWorkspace: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenSchedule?: () => void;
  /** 第一方扩展点；titleBar 渲染到 TopBarMenuSlot（spec 4.2） */
  readonly extensions?: NovelUiExtensions;
}

/** 顶栏（memo：流式发布期间跳过，gui-performance-2 功能点五） */
export const TopBar = memo(function TopBar({
  workspaceName,
  workspaceSub,
  sidebarMode,
  onToggleSidebar,
  onOpenWorkspace,
  onOpenSettings,
  onOpenSchedule,
  extensions,
}: TopBarProps) {
  const TitleBar = extensions?.titleBar;
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
      {TitleBar !== undefined ? (
        <TopBarMenuSlot>
          <TitleBar />
        </TopBarMenuSlot>
      ) : null}
      <span className={styles.spacer} />
      {onOpenSchedule !== undefined ? (
        <TopBarAction label="计划" onClick={onOpenSchedule} />
      ) : null}
      <span className={styles.spacer} />
      <TopBarAction label="Workspace" icon={<Icon icon={FolderOpen} size="sm" />} onClick={onOpenWorkspace} />
      <TopBarAction label="设置" icon={<Icon icon={Settings} size="sm" />} onClick={onOpenSettings} />
    </header>
  );
});
