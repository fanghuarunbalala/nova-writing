/**
 * Sidebar
 *
 * 左侧栏容器（对齐原型 + spec 4.3 排序）：
 * 新建 -> 内容(auto-fill) -> 对话。
 * 待办组已移除（待办只在计划视图，与原型一致）；待审批队列入口在右侧
 * 审批面板（inspector）。v2 原型已删 side-foot，故不再渲染 footer。
 * 右缘 DragHandle 拖拽调宽（widthPx 未拖时缺省 tokens --sidebar-width）。
 */
import { memo, type CSSProperties } from "react";
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import type { NovelOverviewStore } from "../../domains/novel/overview/NovelOverviewStore.js";
import type { ToastStore } from "../../shared/state/ToastStore.js";
import { DragHandle } from "../../shared/primitives/DragHandle.js";
import type { ContentTab } from "../main/contentTab.js";
import { ContentSection } from "./sections/ContentSection.js";
import { ConversationListSection } from "./sections/ConversationListSection.js";
import { NewConversationSection } from "./sections/NewConversationSection.js";
import { SidebarSection } from "./SidebarSection.js";
import styles from "./Sidebar.module.css";

export interface SidebarProps {
  readonly mode: "expanded" | "collapsed";
  /** 用户拖拽后的宽度（px）；未拖时 undefined 走 tokens 缺省宽 */
  readonly widthPx?: number;
  /** 右缘拖拽调宽（delta 累计位移；collapsed 时手柄不渲染） */
  readonly onResizeWidth?: (delta: number) => void;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly novelOverview: NovelOverviewStore;
  readonly toastStore: ToastStore;
  readonly onCreateConversation: () => void;
  /**
   * 选择对话时触发。宿主应在此同时调用 catalog.selectConversation(id)
   * 与 mainViewRouter.transition("chat")，以保证 ChatSurface 切换到对应对话。
   */
  readonly onSelectConversation: (id: string) => void;
  readonly contentTab: ContentTab;
  readonly onSelectContentPane: (pane: ContentTab) => void;
  /**
   * 以下字段为 ApplicationShell 调用方兼容保留：v2 原型已删 side-foot，
   * Sidebar 不再渲染 footer，这些值在此未使用。
   */
  readonly workspaceId?: string;
  readonly workspaceLabel?: string;
  readonly revision?: string;
  readonly pendingApprovalCount?: number;
  readonly onOpenWorkspace?: () => void;
}

/** 左侧栏容器（memo：流式发布期间跳过，gui-performance-2 功能点五） */
export const Sidebar = memo(function Sidebar({
  mode,
  widthPx,
  onResizeWidth,
  conversationCatalog,
  novelOverview,
  toastStore,
  onCreateConversation,
  onSelectConversation,
  contentTab,
  onSelectContentPane,
}: SidebarProps) {
  const snapshot = conversationCatalog.getSnapshot();
  const style =
    widthPx !== undefined
      ? ({ width: widthPx, "--sidebar-current-w": `${widthPx}px` } as CSSProperties)
      : undefined;
  return (
    <aside
      className={styles.sidebar}
      data-mode={mode}
      role="navigation"
      aria-label="侧栏"
      style={style}
    >
      <NewConversationSection
        onCreate={onCreateConversation}
        disabled={snapshot.workspaceId === undefined}
      />
      <ContentSection overview={novelOverview} activePane={contentTab} onSelectPane={onSelectContentPane} />
      <SidebarSection label="对话" count={snapshot.conversations.length}>
        <ConversationListSection
          store={conversationCatalog}
          toastStore={toastStore}
          onSelect={onSelectConversation}
        />
      </SidebarSection>
      {mode === "expanded" && onResizeWidth !== undefined ? (
        <div className={styles.dragAnchor}>
          <DragHandle
            orientation="horizontal"
            ariaLabel="调整侧栏宽度"
            onResize={onResizeWidth}
          />
        </div>
      ) : null}
    </aside>
  );
});
