/**
 * Sidebar
 *
 * 左侧栏容器：新建 + 对话 + 待办 + footing；折叠由宿主控制宽度。
 */
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import type { ScheduleStore } from "../../domains/schedule/store/ScheduleStore.js";
import type { ScheduleTodoStore } from "../../domains/schedule/store/ScheduleTodoStore.js";
import { ConversationListSection } from "./sections/ConversationListSection.js";
import { NewConversationSection } from "./sections/NewConversationSection.js";
import { TodoSection } from "./sections/TodoSection.js";
import { WorkspaceFootingSection } from "./sections/WorkspaceFootingSection.js";
import { SidebarSection } from "./SidebarSection.js";
import { SidebarToggleButton } from "./SidebarToggleButton.js";
import styles from "./Sidebar.module.css";

export interface SidebarProps {
  readonly mode: "expanded" | "collapsed";
  readonly onToggle: () => void;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly onCreateConversation: () => void;
  readonly schedule: ScheduleStore;
  readonly scheduleTodo: ScheduleTodoStore;
  readonly workspaceId?: string;
  readonly workspaceLabel?: string;
  readonly onOpenWorkspace?: () => void;
  readonly onTodoAction?: (id: string, action: string) => void;
}

export function Sidebar({
  mode,
  onToggle,
  conversationCatalog,
  onCreateConversation,
  schedule,
  scheduleTodo,
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
      <SidebarSection label="待办">
        <TodoSection schedule={schedule} scheduleTodo={scheduleTodo} onAction={onTodoAction} />
      </SidebarSection>
      <WorkspaceFootingSection
        workspaceId={workspaceId}
        label={workspaceLabel}
        meta={workspaceId === undefined ? "" : workspaceId.slice(0, 12)}
        onClick={onOpenWorkspace}
      />
      <SidebarToggleButton collapsed={mode === "collapsed"} onToggle={onToggle} />
    </aside>
  );
}
