/**
 * TopBar
 *
 * 顶栏（对齐 demo）：侧栏切换 + 品牌（渐变圆点+名称）+ 工作区 chip
 * （folder 图标+名称+下拉箭头）+ 中央主视图分段切换器（对话/内容/计划，
 * 滑块指示）+ 右侧纯图标动作（打开工作区/设置）。
 * 审批入口已移除（待审批时右侧面板自动展开，见 ApplicationShell 的自动展开 effect）。
 * TopBarMenuSlot 渲染 extensions.titleBar 注入的桌面专属内容（spec 4.2）。
 */
import { memo } from "react";
import { ChevronDown, FolderOpen, PanelLeft, Settings } from "lucide-react";
import { Icon } from "../../shared/primitives/Icon.js";
import { IconButton } from "../../shared/primitives/IconButton.js";
import type { MainViewState } from "../../shared/routing/MainViewRouter.js";
import type { NovelUiExtensions } from "../../extensions/NovelUiExtensions.js";
import type {
  NotificationItem,
  NotificationStore,
} from "../../domains/notification/index.js";
import { NotificationBell } from "./NotificationBell.js";
import { TopBarMenuSlot } from "./TopBarMenuSlot.js";
import { TopBarViewSwitcher } from "./TopBarViewSwitcher.js";
import { WindowControls, type WindowChromeProps } from "./WindowControls.js";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  readonly workspaceName?: string;
  readonly sidebarMode: "expanded" | "collapsed";
  readonly onToggleSidebar: () => void;
  /** 当前主视图（驱动中央分段切换器） */
  readonly view: MainViewState;
  readonly onViewChange: (state: MainViewState) => void;
  /** 书库视图（试验功能）开关：透传分段切换器（缺省隐藏） */
  readonly libraryEnabled?: boolean;
  readonly onOpenWorkspace: () => void;
  readonly onOpenSettings: () => void;
  /** 通知中心（demo 铃铛）：传入即在「打开工作区」与「设置」之间渲染 */
  readonly notifications?: NotificationStore;
  readonly onNotificationActivate?: (item: NotificationItem) => void;
  /** 第一方扩展点；titleBar 渲染到 TopBarMenuSlot（spec 4.2） */
  readonly extensions?: NovelUiExtensions;
  /** 窗口控制（PRD WC）：mac 渲染在左缘（红绿灯位）、win 渲染在右缘（设置钮后） */
  readonly windowChrome?: WindowChromeProps;
}

/** 顶栏（memo：流式发布期间跳过，gui-performance-2 功能点五） */
export const TopBar = memo(function TopBar({
  workspaceName,
  sidebarMode,
  onToggleSidebar,
  view,
  onViewChange,
  libraryEnabled,
  onOpenWorkspace,
  onOpenSettings,
  notifications,
  onNotificationActivate,
  extensions,
  windowChrome,
}: TopBarProps) {
  const TitleBar = extensions?.titleBar;
  return (
    <header className={styles.topbar}>
      {windowChrome !== undefined && windowChrome.platform === "mac" ? (
        <WindowControls {...windowChrome} />
      ) : null}
      <IconButton
        label={sidebarMode === "expanded" ? "收起侧栏" : "展开侧栏"}
        size="sm"
        onClick={onToggleSidebar}
      >
        <Icon icon={PanelLeft} size="sm" />
      </IconButton>
      <div className={styles.brand}>
        <span className={styles.brandDot} />
        <span className={styles.brandName}>Novel</span>
      </div>
      {workspaceName !== undefined ? (
        <button type="button" className={styles.wsChip} onClick={onOpenWorkspace} title={workspaceName}>
          <Icon icon={FolderOpen} size="xs" />
          <span>{workspaceName}</span>
          <Icon icon={ChevronDown} size="xs" />
        </button>
      ) : null}
      {TitleBar !== undefined ? (
        <TopBarMenuSlot>
          <TitleBar />
        </TopBarMenuSlot>
      ) : null}
      <span className={styles.spacer} />
      <TopBarViewSwitcher state={view} onChange={onViewChange} libraryEnabled={libraryEnabled} />
      <span className={styles.spacer} />
      <div
        className={styles.tbRight}
        data-win={windowChrome !== undefined && windowChrome.platform === "win" ? "true" : undefined}
      >
        <IconButton label="打开工作区" size="sm" onClick={onOpenWorkspace}>
          <Icon icon={FolderOpen} size="sm" />
        </IconButton>
        {notifications !== undefined ? (
          <NotificationBell
            store={notifications}
            onActivate={onNotificationActivate}
            onOpenSettings={onOpenSettings}
          />
        ) : null}
        <IconButton label="设置" size="sm" onClick={onOpenSettings}>
          <Icon icon={Settings} size="sm" />
        </IconButton>
        {windowChrome !== undefined && windowChrome.platform === "win" ? (
          <WindowControls {...windowChrome} />
        ) : null}
      </div>
    </header>
  );
});
