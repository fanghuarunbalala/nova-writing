/**
 * sidebar 组件测试：上下文目录（PRD SB）——对话/内容/计划三态 + 左栏拖宽。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
import { NotificationStore } from "../../src/domains/notification/store/NotificationStore.js";
import { ApprovalStore } from "../../src/domains/approval/ApprovalStore.js";
import { LibraryStore } from "../../src/domains/library/store/LibraryStore.js";
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
      notifications: new NotificationStore(),
      approvalStore: new ApprovalStore({ api }),
      library: new LibraryStore({ api }),
    },
  };
}

function sidebarElement(
  stores: ReturnType<typeof makeStores>["stores"],
  props: Partial<Parameters<typeof Sidebar>[0]> = {},
) {
  return (
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
      outlineTree={stores.storyOutlineTree}
      manuscript={stores.manuscriptStructure}
      characters={stores.character}
      locations={stores.location}
      schedule={stores.schedule}
      scheduleTodo={stores.scheduleTodo}
      approvalStore={stores.approvalStore}
      library={stores.library}
      {...props}
    />
  );
}

function renderSidebar(
  stores: ReturnType<typeof makeStores>["stores"],
  props: Partial<Parameters<typeof Sidebar>[0]> = {},
) {
  return render(sidebarElement(stores, props));
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
    await user.click(screen.getByRole("button", { name: "开始一段新的创作" }));
    expect(onCreateConversation).toHaveBeenCalledTimes(1);
  });

  it("content view: seg tabs switch panes and notify host", async () => {
    const user = userEvent.setup();
    const { stores } = makeStores();
    await stores.conversationCatalog.loadWorkspace("w1");
    const onSelectContentPane = vi.fn();
    renderSidebar(stores, { view: "content", onSelectContentPane });
    // 四段资料位（大纲/正文/人物/地点；计数在 dirHead 标题行，不在 tab 上）。
    for (const name of ["大纲", "正文", "人物", "地点"]) {
      expect(screen.getByRole("tab", { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.getByText("故事单元")).toBeInTheDocument();
    // 对话目录在内容视图不可见（上下文切换）。
    expect(screen.queryByText(/对话 tion_a/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /人物/ }));
    expect(onSelectContentPane).toHaveBeenCalledWith("characters");
  });

  it("plan view: overview row + 安排 directory（审批组常驻 + 自动化占位）", () => {
    const { stores } = makeStores();
    renderSidebar(stores, { view: "schedule" });
    expect(screen.getByText("总览")).toBeInTheDocument();
    expect(screen.getByText("统计 · 双状态轴 · 大纲进度")).toBeInTheDocument();
    // 审批组常驻（无待办时轻提示）+ 自动化占位组（路线图，UI 骨架）
    expect(screen.getByText("待审批")).toBeInTheDocument();
    expect(screen.getByText("暂无待审批")).toBeInTheDocument();
    expect(screen.getByText("自动化")).toBeInTheDocument();
    expect(screen.getByText("定时自动化编排 · 规划中")).toBeInTheDocument();
  });

  it("injects custom width and resets on grip double-click (左栏拖宽/复位)", () => {
    const { stores } = makeStores();
    const onWidthChange = vi.fn();
    const { rerender } = renderSidebar(stores, { widthPx: 320, onWidthChange });
    // 自定义宽度经 inline --sidebar-current-w 注入（jsdom 无 matchMedia → 视为宽档）
    const aside = document.querySelector("aside") as HTMLElement;
    expect(aside.style.getPropertyValue("--sidebar-current-w")).toBe("320px");
    // 双击把手 → 复位回调（undefined = 断点缺省 272）
    const grip = screen.getByRole("separator", { name: "拖拽调整目录宽度" });
    grip.parentElement?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(onWidthChange).toHaveBeenCalledWith(undefined);
    // 复位后（widthPx=undefined）不再注入 inline 宽度
    rerender(sidebarElement(stores, { onWidthChange }));
    expect(aside.style.getPropertyValue("--sidebar-current-w")).toBe("");
  });

  it("grip drag emits width deltas and clamps at bounds (200–480)", async () => {
    const { stores } = makeStores();
    const onWidthChange = vi.fn();
    renderSidebar(stores, { onWidthChange });
    const grip = screen.getByRole("separator", { name: "拖拽调整目录宽度" });
    // 把手在右缘：右移 = 正 delta = 增宽（缺省 272 + 80 = 352）；
    // DragHandle 的 move delta 经 rAF 节流后回调 → 等一帧以上再断言
    fireEvent.pointerDown(grip, { button: 0, clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 180 });
    await new Promise((resolve) => setTimeout(resolve, 32));
    fireEvent.pointerUp(window);
    expect(onWidthChange).toHaveBeenCalledWith(352);
    // 越界 clamp：再拖 +5000 → 上限 480（widthPx 未回流仍按 272 起算）
    fireEvent.pointerDown(grip, { button: 0, clientX: 180 });
    fireEvent.pointerMove(window, { clientX: 5180 });
    await new Promise((resolve) => setTimeout(resolve, 32));
    fireEvent.pointerUp(window);
    expect(onWidthChange).toHaveBeenLastCalledWith(480);
  });

  it("hides grip when collapsed or width control not provided", () => {
    const { stores } = makeStores();
    // 无 onWidthChange（宿主未接线拖宽）→ 不渲染把手
    const { rerender } = renderSidebar(stores);
    expect(screen.queryByRole("separator", { name: "拖拽调整目录宽度" })).not.toBeInTheDocument();
    // 折叠态（负 margin 收起）同样不渲染，避免把手悬在主区上
    rerender(sidebarElement(stores, { mode: "collapsed", onWidthChange: vi.fn() }));
    expect(screen.queryByRole("separator", { name: "拖拽调整目录宽度" })).not.toBeInTheDocument();
  });
});

describe("SidebarSection", () => {
  it("renders label and count", () => {
    render(<SidebarSection label="对话" count={3}>内容</SidebarSection>);
    expect(screen.getByText("对话")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
