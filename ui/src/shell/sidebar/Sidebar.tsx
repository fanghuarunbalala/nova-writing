/**
 * Sidebar
 *
 * 左侧栏容器（对齐原型 + spec 4.3 排序）：
 * 新建 -> 对话 -> 审批(延后) -> 待办 -> 内容(auto-fill) -> footing。
 * footing 始终贴底（margin-top: auto 由 WorkspaceFootingSection 提供）。
 */
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import type { NovelOverviewStore } from "../../domains/novel/overview/NovelOverviewStore.js";
import type { ScheduleStore } from "../../domains/schedule/store/ScheduleStore.js";
import type { ScheduleTodoStore } from "../../domains/schedule/store/ScheduleTodoStore.js";
import type { ContentTab } from "../main/ContentTabs.js";
import { ContentSection } from "./sections/ContentSection.js";
import { ConversationListSection } from "./sections/ConversationListSection.js";
import { NewConversationSection } from "./sections/NewConversationSection.js";
import { TodoSection } from "./sections/TodoSection.js";
import { WorkspaceFootingSection } from "./sections/WorkspaceFootingSection.js";
import { SidebarSection } from "./SidebarSection.js";
import styles from "./Sidebar.module.css";

export interface SidebarProps {
  readonly mode: "expanded" | "collapsed";
  readonly conversationCatalog: ConversationCatalogStore;
  readonly novelOverview: NovelOverviewStore;
  readonly onCreateConversation: () => void;
  readonly schedule: ScheduleStore;
  readonly scheduleTodo: ScheduleTodoStore;
  readonly contentTab: ContentTab;
  readonly onSelectContentPane: (pane: ContentTab) => void;
  readonly workspaceId?: string;
  readonly workspaceLabel?: string;
  readonly onOpenWorkspace?: () => void;
  readonly onTodoAction?: (id: string, action: string) => void;
}

export function Sidebar({
  mode,
  conversationCatalog,
  novelOverview,
  onCreateConversation,
  schedule,
  scheduleTodo,
  contentTab,
  onSelectContentPane,
  workspaceId,
  workspaceLabel,
  onOpenWorkspace,
  onTodoAction,
}: SidebarProps) {
  const snapshot = conversationCatalog.getSnapshot();
  return (
    <aside className={styles.sidebar} data-mode={mode} role="navigation" aria-label="侧栏">
      <NewConversationSection
        onCreate={onCreateConversation}
        disabled={snapshot.workspaceId === undefined}
      />
      <SidebarSection label="对话" count={snapshot.conversations.length}>
        <ConversationListSection
          store={conversationCatalog}
          onSelect={(id) => conversationCatalog.selectConversation(id)}
        />
      </SidebarSection>
      {/*
        审批 section（ApprovalQueueSection）随 approval 域延后（spec 4.3 / 11）。
        落地后在此处插入，位于 对话 与 待办 之间。
      */}
      <SidebarSection label="待办">
        <TodoSection schedule={schedule} scheduleTodo={scheduleTodo} onAction={onTodoAction} />
      </SidebarSection>
      <ContentSection overview={novelOverview} activePane={contentTab} onSelectPane={onSelectContentPane} />
      <WorkspaceFootingSection
        workspaceId={workspaceId}
        label={workspaceLabel}
        meta={workspaceId === undefined ? "" : workspaceId.slice(0, 12)}
        onClick={onOpenWorkspace}
      />
    </aside>
  );
}
