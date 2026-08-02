/** Persistent project navigation and Conversation history presentation. */
export type ProjectNavigationItem =
  | "new-conversation"
  | "schedule"
  | "outline"
  | "characters"
  | "locations"
  | "manuscript";

export interface ConversationSidebarItem {
  readonly id: string;
  readonly title: string;
  readonly active?: boolean;
}

export interface ProjectSidebarProps {
  readonly conversations?: readonly ConversationSidebarItem[];
  readonly onNavigate?: (item: ProjectNavigationItem) => void;
  readonly onConversationSelect?: (conversationId: string) => void;
}

const NAVIGATION_ITEMS: readonly {
  readonly id: ProjectNavigationItem;
  readonly marker: string;
  readonly label: string;
}[] = Object.freeze([
  Object.freeze({ id: "new-conversation", marker: "+", label: "新对话" }),
  Object.freeze({ id: "schedule", marker: "◷", label: "安排" }),
  Object.freeze({ id: "outline", marker: "◇", label: "大纲" }),
  Object.freeze({ id: "characters", marker: "人", label: "人物" }),
  Object.freeze({ id: "locations", marker: "⌖", label: "地点" }),
  Object.freeze({ id: "manuscript", marker: "文", label: "正文" }),
]);

export function ProjectSidebar({
  conversations = [],
  onNavigate,
  onConversationSelect,
}: ProjectSidebarProps) {
  return (
    <aside className="novel-project-sidebar" aria-label="项目导航">
      <section className="novel-sidebar-section">
        <h2 className="novel-sidebar-heading">创作</h2>
        {NAVIGATION_ITEMS.map((item) => (
          <button
            className="novel-sidebar-button"
            key={item.id}
            type="button"
            onClick={() => onNavigate?.(item.id)}
          >
            <span className="novel-sidebar-marker" aria-hidden="true">
              {item.marker}
            </span>
            {item.label}
          </button>
        ))}
      </section>
      <section className="novel-sidebar-section">
        <h2 className="novel-sidebar-heading">对话</h2>
        {conversations.length === 0 ? (
          <div className="novel-sidebar-button" aria-disabled="true">
            暂无对话
          </div>
        ) : (
          conversations.map((conversation) => (
            <button
              className="novel-sidebar-button"
              data-active={conversation.active === true}
              key={conversation.id}
              type="button"
              onClick={() => onConversationSelect?.(conversation.id)}
            >
              <span className="novel-sidebar-marker" aria-hidden="true">
                ●
              </span>
              {conversation.title}
            </button>
          ))
        )}
      </section>
    </aside>
  );
}
