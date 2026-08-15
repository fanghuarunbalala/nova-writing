/**
 * ApplicationShell 冒烟：组合渲染、workspace 加载、视图切换、inspector 联动。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MainViewRouter } from "../../src/shared/routing/MainViewRouter.js";
import { InspectorRouter } from "../../src/shared/routing/InspectorRouter.js";
import { ToastStore } from "../../src/shared/state/ToastStore.js";
import { ConversationCatalogStore } from "../../src/domains/conversation/store/ConversationCatalogStore.js";
import { NovelOverviewStore } from "../../src/domains/novel/overview/NovelOverviewStore.js";
import { StoryOutlineTreeStore } from "../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";
import { ManuscriptStructureStore } from "../../src/domains/novel/manuscript/store/ManuscriptStructureStore.js";
import { CharacterStore } from "../../src/domains/novel/character/store/CharacterStore.js";
import { LocationStore } from "../../src/domains/novel/location/store/LocationStore.js";
import { ScheduleStore } from "../../src/domains/schedule/store/ScheduleStore.js";
import { ScheduleTodoStore } from "../../src/domains/schedule/store/ScheduleTodoStore.js";
import { type WorkspaceControllerPort } from "../../src/domains/workspace/store/WorkspaceControllerAdapter.js";
import { ApplicationShell } from "../../src/shell/ApplicationShell.js";
import type { WorkspaceControllerSnapshot } from "../../src/domains/workspace/controller/WorkspaceController.js";

function buildApi() {
  return {
    conversations: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ conversationId: "conversation_new", handle: {} })),
      open: vi.fn(),
      history: vi.fn(async () => []),
      getMode: vi.fn(async () => "review"),
    },
    approvals: {
      list: vi.fn(async () => []),
      resolve: vi.fn(async () => true),
    },
    novel: {
      overview: {
        get: vi.fn(async () => ({
          novelId: "novel_1",
          title: "novel_1",
          counts: { storyUnits: 1, characters: 0, locations: 0, paragraphs: 0 },
        })),
      },
      outline: {
        get: vi.fn(async () => ({
          outline: { id: "o1", novelId: "novel_1" },
          units: [
            {
              id: "arc-v1",
              entityVersion: 1,
              outlineId: "o1",
              orderKey: "0001",
              title: "第一卷：旧船坞",
              scope: "arc",
              planningStatus: "ready",
              realizationStatus: "in-progress",
            },
          ],
        })),
        getStoryUnit: vi.fn(),
      },
      characters: {
        list: vi.fn(async () => []),
        get: vi.fn(),
      },
      locations: {
        list: vi.fn(async () => []),
        get: vi.fn(),
      },
      paragraphs: {
        list: vi.fn(async () => []),
        get: vi.fn(),
      },
      publication: {
        get: vi.fn(async () => ({
          structure: { id: "publication_main", novelId: "novel_1" },
          volumes: [],
          chapters: [],
        })),
      },
    },
  } as never;
}

class FakeWorkspaceController implements WorkspaceControllerPort {
  snapshot: WorkspaceControllerSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(snapshot: WorkspaceControllerSnapshot) {
    this.snapshot = snapshot;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): WorkspaceControllerSnapshot => this.snapshot;

  async refresh(): Promise<void> {}
}

async function renderShell() {
  const api = buildApi();
  const conversationCatalog = new ConversationCatalogStore({ api });
  const novelOverview = new NovelOverviewStore({ api });
  const storyOutlineTree = new StoryOutlineTreeStore({ api });
  const manuscriptStructure = new ManuscriptStructureStore({ api });
  const character = new CharacterStore({ api });
  const location = new LocationStore({ api });
  const schedule = new ScheduleStore({ novelOverview, outlineTree: storyOutlineTree, conversationCatalog });
  const workspaceController = new FakeWorkspaceController({
    revision: 1,
    phase: "ready",
    current: { id: "w1", label: "白昼计划" },
    recent: [],
  });
  const result = render(
    <ApplicationShell
      api={api}
      mainViewRouter={new MainViewRouter()}
      inspectorRouter={new InspectorRouter()}
      workspaceController={workspaceController}
      domainStores={{
        conversationCatalog,
        novelOverview,
        storyOutlineTree,
        manuscriptStructure,
        character,
        location,
        schedule,
        scheduleTodo: new ScheduleTodoStore(),
      }}
      toastStore={new ToastStore()}
    />,
  );
  return { ...result, api };
}

describe("ApplicationShell smoke", () => {
  it("renders the shell and loads the workspace into domains", async () => {
    const user = userEvent.setup();
    const { api } = await renderShell();
    expect(screen.getAllByText("白昼计划").length).toBeGreaterThan(0);
    // 计划视图侧栏 = 安排目录（总览行 + 待办分组；PRD SB-10），无会话目录。
    await user.click(screen.getByRole("tab", { name: "计划" }));
    expect(await screen.findByText("总览")).toBeInTheDocument();
    expect(api.conversations.list).toHaveBeenCalledWith();
    expect(api.novel.overview.get).toHaveBeenCalled();
    expect(api.novel.outline.get).toHaveBeenCalled();
  });

  it("switches to content view and shows the outline unit detail", async () => {
    const user = userEvent.setup();
    await renderShell();
    // 资料位在内容视图侧栏：先经顶栏切到内容视图（PRD SB-1 上下文目录）。
    await user.click(screen.getByRole("tab", { name: "内容" }));
    expect(await screen.findByText("第一卷：旧船坞")).toBeInTheDocument();
    // 点击侧栏树节点 → 主区渲染选中单元详情（PRD OL-1，不再开 inspector）。
    await user.click(screen.getByText("第一卷：旧船坞"));
    expect(screen.getAllByText("第一卷：旧船坞").length).toBeGreaterThanOrEqual(2);
  });

  it("switches to the selected conversation when a sidebar conversation is clicked", async () => {
    const user = userEvent.setup();
    const api = buildApi();
    api.conversations.list = vi.fn(async () => [
      // 未命名会话（name === conversationId）→ 列表走 autoTitle「对话 <id 尾 6 位>」
      { conversationId: "conversation_000001", name: "conversation_000001", storeDir: "", status: "active" },
      { conversationId: "conversation_000002", name: "conversation_000002", storeDir: "", status: "active" },
    ]);
    const conversationCatalog = new ConversationCatalogStore({ api });
    const novelOverview = new NovelOverviewStore({ api });
    const storyOutlineTree = new StoryOutlineTreeStore({ api });
    const manuscriptStructure = new ManuscriptStructureStore({ api });
    const character = new CharacterStore({ api });
    const location = new LocationStore({ api });
    const schedule = new ScheduleStore({ novelOverview, outlineTree: storyOutlineTree, conversationCatalog });
    const workspaceController = new FakeWorkspaceController({
      revision: 1,
      phase: "ready",
      current: { id: "w1", label: "白昼计划" },
      recent: [],
    });
    render(
      <ApplicationShell
        api={api}
        mainViewRouter={new MainViewRouter()}
        inspectorRouter={new InspectorRouter()}
        workspaceController={workspaceController}
        domainStores={{
          conversationCatalog,
          novelOverview,
          storyOutlineTree,
          manuscriptStructure,
          character,
          location,
          schedule,
          scheduleTodo: new ScheduleTodoStore(),
        }}
        toastStore={new ToastStore()}
      />,
    );
    await screen.findAllByText("对话 000002");
    // 用户场景：切到内容视图（侧栏变资料目录），经顶栏切回对话再选会话。
    await user.click(screen.getByRole("tab", { name: "内容" }));
    expect(await screen.findByText("第一卷：旧船坞")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "对话" }));
    await user.click(screen.getAllByText("对话 000001")[0]);
    // chat 视图不再渲染会话标题 heading，改为断言对话输入框出现（切回聊天）。
    expect(
      await screen.findByRole("textbox", { name: "对话输入" }),
    ).toBeInTheDocument();
  });
});
