/**
 * TopBar
 *
 * 顶栏（对齐原型）：侧栏切换 + wordmark + workspace 名/副标 + 右侧
 * Workspace/设置动作 + 修订号。计划/审批入口已移除：计划与内容视图大纲
 * 重叠（大纲进度 + 待办均在侧栏有入口）；审批域延后，占位按钮无意义。
 * TopBarMenuSlot 渲染 extensions.titleBar 注入的桌面专属内容（spec 4.2）。
 */
import { FolderOpen, PanelLeft, Settings } from "lucide-react";
import { Icon } from "../../shared/primitives/Icon.js";
import { IconButton } from "../../shared/primitives/IconButton.js";
import type { NovelUiExtensions } from "../../extensions/NovelUiExtensions.js";
import { TopBarAction } from "./TopBarAction.js";
import { TopBarMenuSlot } from "./TopBarMenuSlot.js";
import { TopBarRevisionMeta } from "./TopBarRevisionMeta.js";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  readonly workspaceName?: string;
  readonly workspaceSub?: string;
  readonly revision?: string;
  readonly sidebarMode: "expanded" | "collapsed";
  readonly onToggleSidebar: () => void;
  readonly onOpenWorkspace: () => void;
  readonly onOpenSettings: () => void;
  /** 第一方扩展点；titleBar 渲染到 TopBarMenuSlot（spec 4.2） */
  readonly extensions?: NovelUiExtensions;
}

export function TopBar({
  workspaceName,
  workspaceSub,
  revision,
  sidebarMode,
  onToggleSidebar,
  onOpenWorkspace,
  onOpenSettings,
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
      <TopBarRevisionMeta revision={revision} />
      <span className={styles.spacer} />
      <TopBarAction label="Workspace" icon={<Icon icon={FolderOpen} size="sm" />} onClick={onOpenWorkspace} />
      <TopBarAction label="设置" icon={<Icon icon={Settings} size="sm" />} onClick={onOpenSettings} />
    </header>
  );
}
