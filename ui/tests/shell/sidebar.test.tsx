/**
 * sidebar 组件测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "../../src/shell/sidebar/Sidebar.js";
import { SidebarSection } from "../../src/shell/sidebar/SidebarSection.js";
import { SidebarToggleButton } from "../../src/shell/sidebar/SidebarToggleButton.js";
import { ConversationCatalogStore } from "../../src/domains/conversation/store/ConversationCatalogStore.js";
import { ScheduleStore } from "../../src/domains/schedule/store/ScheduleStore.js";
import { ScheduleTodoStore } from "../../src/domains/schedule/store/ScheduleTodoStore.js";
import { NovelOverviewStore } from "../../src/domains/novel/overview/NovelOverviewStore.js";
import { StoryOutlineTreeStore } from "../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";

function makeStores() {
  const api = {
    conversations: {
      list: vi.fn(async () => ({
        conversations: [
          {
            metadata: {
              id: "conversation_a",
              workspaceId: "w1",
              rootConversationId: "conversation_a",
              status: "active",
              createdAt: "2026-08-05T09:00:00.000Z",
              updatedAt: "2026-08-05T09:00:00.000Z",
              lastJournalSequence: 0,
            },
            activeAgentBinding: {
              id: "b1",
              conversationId: "conversation_a",
              revision: 1,
              status: "active",
              createdAt: "2026-08-05T09:00:00.000Z",
              agentType: "novel",
              definitionVersion: "1.0.0",
            },
          },
        ],
      })),
      create: vi.fn(),
      open: vi.fn(),
    },
    novel: {
      overview: { get: vi.fn() },
      outline: { get: vi.fn(), getStoryUnit: vi.fn() },
      characters: {},
      locations: {},
      manuscript: {},
    },
  } as never;
  const conversationCatalog = new ConversationCatalogStore({ api });
  const novelOverview = new NovelOverviewStore({ api });
  const outlineTree = new StoryOutlineTreeStore({ api });
  const schedule = new ScheduleStore({ novelOverview, outlineTree, conversationCatalog });
  return { conversationCatalog, schedule };
}

describe("Sidebar", () => {
  it("renders sections, conversations and toggles", async () => {
    const user = userEvent.setup();
    const { conversationCatalog, schedule } = makeStores();
    await conversationCatalog.loadWorkspace("w1");
    const onToggle = vi.fn();
    const onCreateConversation = vi.fn();
    render(
      <Sidebar
        mode="expanded"
        onToggle={onToggle}
        conversationCatalog={conversationCatalog}
        onCreateConversation={onCreateConversation}
        schedule={schedule}
        scheduleTodo={new ScheduleTodoStore()}
        workspaceId="w1"
        workspaceLabel="白昼计划"
      />,
    );
    expect(screen.getByText("白昼计划")).toBeInTheDocument();
    expect(screen.getByText(/对话 tion_a/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新建对话" }));
    expect(onCreateConversation).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "收起侧栏" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("SidebarSection / SidebarToggleButton", () => {
  it("renders label and count", () => {
    render(<SidebarSection label="对话" count={3}>内容</SidebarSection>);
    expect(screen.getByText("对话")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("toggles collapse direction", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<SidebarToggleButton collapsed={false} onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: "收起侧栏" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
