/**
 * sidebar 组件测试：上下文目录（PRD SB）——对话/内容/计划三态。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "../../src/shell/sidebar/Sidebar.js";
import { SidebarSection } from "../../src/shell/sidebar/SidebarSection.js";
import { ConversationCatalogStore } from "../../src/domains/conversation/store/ConversationCatalogStore.js";
import { NovelOverviewStore } from "../../src/domains/novel/overview/NovelOverviewStore.js";
import { StoryOutlineTreeStore } from "../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";
import { ManuscriptStructureStore } from "../../src/domains/novel/manuscript/store/ManuscriptStructureStore.js";
import { CharacterStore } from "../../src/domains/novel/character/store/CharacterStore.js";
import { LocationStore } from "../../src/domains/novel/location/store/LocationStore.js";
import { ScheduleStore } from "../../src/domains/schedule/store/ScheduleStore.js";
import { ScheduleTodoStore } from "../../src/domains/schedule/store/ScheduleTodoStore.js";
import { ApprovalStore } from "../../src/domains/approval/ApprovalStore.js";
import { ToastStore } from "../../src/shared/state/ToastStore.js";

function makeStores() {
  const api = {
    conversations: {
      list: vi.fn(async () => [
        // 未命名会话（name === conversationId）→ 列表走 autoTitle「对话 <id 尾 6 位>」
        { conversationId: "conversation_a", name: "conversation_a", storeDir: "", status: "active" },
      ]),
      create: vi.fn(),
      open: vi.fn(),
    },
    approvals: { list: vi.fn(async () => []), resolve: vi.fn() },
    novel: {
      overview: {
        get: vi.fn(async () => ({
          novelId: "n1",
          title: "n1",
          counts: { storyUnits: 1, characters: 0, locations: 0, paragraphs: 0 },
        })),
      },
      outline: { get: vi.fn(async () => ({ units: [] })), getStoryUnit: vi.fn() },
      characters: { list: vi.fn(async () => []), get: vi.fn() },
      locations: { list: vi.fn(async () => []), get: vi.fn() },
      paragraphs: { list: vi.fn(async () => []), get: vi.fn() },
      publication: { get: vi.fn(async () => ({ volumes: [], chapters: [] })) },
    },
  } as never;
  const conversationCatalog = new ConversationCatalogStore({ api });
  const novelOverview = new NovelOverviewStore({ api });
  const storyOutlineTree = new StoryOutlineTreeStore({ api });
  const manuscriptStructure = new ManuscriptStructureStore({ api });
  const character = new CharacterStore({ api });
  const location = new LocationStore({ api });
  const schedule = new ScheduleStore({ novelOverview, outlineTree: storyOutlineTree, conversationCatalog });
  return {
    api,
    stores: {
      conversationCatalog,
      novelOverview,
      storyOutlineTree,
      manuscriptStructure,
      character,
      location,
      schedule,
      scheduleTodo: new ScheduleTodoStore(),
      approvalStore: new ApprovalStore({ api }),
    },
  };
}

function renderSidebar(
  stores: ReturnType<typeof makeStores>["stores"],
  props: Partial<Parameters<typeof Sidebar>[0]> = {},
) {
  return render(
    <Sidebar
      mode="expanded"
      view="chat"
      toastStore={new ToastStore()}
      workspaceId="w1"
      onCreateConversation={vi.fn()}
      onSelectConversation={vi.fn()}
      contentTab="outline"
      onSelectContentPane={vi.fn()}
      onSelectOutlineUnit={vi.fn()}
      onSelectChapter={vi.fn()}
      onSelectCharacter={vi.fn()}
      onSelectLocation={vi.fn()}
      planTodoId={null}
      onSelectPlanTodo={vi.fn()}
      conversationCatalog={stores.conversationCatalog}
      novelOverview={stores.novelOverview}
      outlineTree={stores.storyOutlineTree}
      manuscript={stores.manuscriptStructure}
      characters={stores.character}
      locations={stores.location}
      schedule={stores.schedule}
      scheduleTodo={stores.scheduleTodo}
      approvalStore={stores.approvalStore}
      {...props}
    />,
  );
}

describe("Sidebar (context directory)", () => {
  it("chat view: new conversation + conversation list, no content tabs", async () => {
    const user = userEvent.setup();
    const { stores } = makeStores();
    await stores.conversationCatalog.loadWorkspace("w1");
    const onCreateConversation = vi.fn();
    renderSidebar(stores, { onCreateConversation });
    expect(screen.getByText(/对话 tion_a/)).toBeInTheDocument();
    // 对话视图不渲染资料位（PRD SB-1）。
    expect(screen.queryByRole("tab", { name: /大纲/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "创建对话" }));
    expect(onCreateConversation).toHaveBeenCalledTimes(1);
  });

  it("content view: seg tabs switch panes and notify host", async () => {
    const user = userEvent.setup();
    const { stores } = makeStores();
    await stores.conversationCatalog.loadWorkspace("w1");
    const onSelectContentPane = vi.fn();
    renderSidebar(stores, { view: "content", onSelectContentPane });
    // 四段资料位（大纲/正文/人物/地点；可访问名含计数，用正则匹配）。
    for (const name of ["大纲", "正文", "人物", "地点"]) {
      expect(screen.getByRole("tab", { name: new RegExp(name) })).toBeInTheDocument();
    }
    // 对话目录在内容视图不可见（上下文切换）。
    expect(screen.queryByText(/对话 tion_a/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /人物/ }));
    expect(onSelectContentPane).toHaveBeenCalledWith("characters");
  });

  it("plan view: overview row + 安排 directory", () => {
    const { stores } = makeStores();
    renderSidebar(stores, { view: "plan" });
    expect(screen.getByText("总览")).toBeInTheDocument();
    expect(screen.getByText("统计 · 双状态轴 · 大纲进度")).toBeInTheDocument();
  });
});

describe("SidebarSection", () => {
  it("renders label and count", () => {
    render(<SidebarSection label="对话" count={3}>内容</SidebarSection>);
    expect(screen.getByText("对话")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
