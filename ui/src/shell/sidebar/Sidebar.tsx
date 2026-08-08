/**
 * Sidebar
 *
 * 左侧栏容器（对齐原型 + spec 4.3 排序）：
 * 新建 -> 内容(auto-fill) -> 对话 -> footing。
 * 待办组已移除（待办只在计划视图，与原型一致）；待审批队列入口在右侧
 * 审批面板（inspector）。footing 始终贴底（margin-top: auto 由
 * WorkspaceFootingSection 提供）。
 */
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import type { NovelOverviewStore } from "../../domains/novel/overview/NovelOverviewStore.js";
import type { ContentTab } from "../main/contentTab.js";
import { ContentSection } from "./sections/ContentSection.js";
import { ConversationListSection } from "./sections/ConversationListSection.js";
import { NewConversationSection } from "./sections/NewConversationSection.js";
import { WorkspaceFootingSection } from "./sections/WorkspaceFootingSection.js";
import { SidebarSection } from "./SidebarSection.js";
import styles from "./Sidebar.module.css";

export interface SidebarProps {
  readonly mode: "expanded" | "collapsed";
  readonly conversationCatalog: ConversationCatalogStore;
  readonly novelOverview: NovelOverviewStore;
  readonly onCreateConversation: () => void;
  /**
   * 选择对话时触发。宿主应在此同时调用 catalog.selectConversation(id)
   * 与 mainViewRouter.transition("chat")，以保证 ChatSurface 切换到对应对话。
   */
  readonly onSelectConversation: (id: string) => void;
  readonly contentTab: ContentTab;
  readonly onSelectContentPane: (pane: ContentTab) => void;
  readonly workspaceId?: string;
  readonly workspaceLabel?: string;
  readonly revision?: string;
  readonly pendingApprovalCount?: number;
  readonly onOpenWorkspace?: () => void;
}

export function Sidebar({
  mode,
  conversationCatalog,
  novelOverview,
  onCreateConversation,
  onSelectConversation,
  contentTab,
  onSelectContentPane,
  workspaceId,
  workspaceLabel,
  revision,
  pendingApprovalCount = 0,
  onOpenWorkspace,
}: SidebarProps) {
  const snapshot = conversationCatalog.getSnapshot();
  return (
    <aside className={styles.sidebar} data-mode={mode} role="navigation" aria-label="侧栏">
      <NewConversationSection
        onCreate={onCreateConversation}
        disabled={snapshot.workspaceId === undefined}
      />
      <ContentSection overview={novelOverview} activePane={contentTab} onSelectPane={onSelectContentPane} />
      <SidebarSection label="对话" count={snapshot.conversations.length}>
        <ConversationListSection
          store={conversationCatalog}
          onSelect={onSelectConversation}
        />
      </SidebarSection>
      <WorkspaceFootingSection
        workspaceId={workspaceId}
        label={workspaceLabel}
        meta={
          revision !== undefined
            ? `${revision} · ${pendingApprovalCount} 待审`
            : workspaceId === undefined
              ? ""
              : workspaceId.slice(0, 12)
        }
        onClick={onOpenWorkspace}
      />
    </aside>
  );
}
