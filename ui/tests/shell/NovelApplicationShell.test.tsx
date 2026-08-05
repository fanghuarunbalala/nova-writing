/**
 * NovelApplicationShell 冒烟：组合渲染、workspace 加载、视图切换、inspector 联动。
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
import { WorkspaceControllerAdapter, type WorkspaceControllerPort } from "../../src/domains/workspace/store/WorkspaceControllerAdapter.js";
import { NovelApplicationShell } from "../../src/shell/NovelApplicationShell.js";
import type { WorkspaceControllerSnapshot } from "../../src/workspace/WorkspaceController.js";

function buildApi() {
  return {
    conversations: {
      list: vi.fn(async () => ({ conversations: [] })),
      create: vi.fn(async () => ({
        getSnapshot: async () => ({
          metadata: {
            id: "conversation_new",
            workspaceId: "w1",
            rootConversationId: "conversation_new",
            status: "active",
            createdAt: "2026-08-05T09:00:00.000Z",
            updatedAt: "2026-08-05T09:00:00.000Z",
            lastJournalSequence: 0,
          },
          activeAgentBinding: {
            id: "b1",
            conversationId: "conversation_new",
            revision: 1,
            status: "active",
            createdAt: "2026-08-05T09:00:00.000Z",
            agentType: "novel",
            definitionVersion: "1.0.0",
          },
        }),
        close: async () => undefined,
      })),
      open: vi.fn(),
    },
    novel: {
      overview: {
        get: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          workspaceId: "w1",
          novelId: "novel_1",
          novelSchemaVersion: 1,
          sourceRevision: "r041",
          counts: { storyUnitCount: 1, characterCount: 0, locationCount: 0, volumeCount: 1, chapterCount: 0, manuscriptBlockCount: 0 },
          roots: {},
        })),
      },
      outline: {
        get: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          tree: {
            outline: { id: "o1", novelId: "novel_1" },
            units: [
              {
                id: "arc-v1",
                outlineId: "o1",
                orderKey: "0001",
                title: "第一卷：旧船坞",
                scope: "arc",
                planningStatus: "ready",
                realizationStatus: "in-progress",
              },
            ],
          },
          progress: [],
        })),
        getStoryUnit: vi.fn(),
      },
      characters: {
        list: vi.fn(async () => ({ schemaVersion: 1, scope: { kind: "canonical" }, characters: [] })),
        get: vi.fn(),
      },
      locations: {
        list: vi.fn(async () => ({ schemaVersion: 1, scope: { kind: "canonical" }, locations: [] })),
        get: vi.fn(),
      },
      manuscript: {
        getStructure: vi.fn(async () => ({ schemaVersion: 1, scope: { kind: "canonical" }, blocks: [] })),
        getBlock: vi.fn(),
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
    <NovelApplicationShell
      api={api}
      mainViewRouter={new MainViewRouter()}
      inspectorRouter={new InspectorRouter()}
      workspaceAdapter={new WorkspaceControllerAdapter(workspaceController)}
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

describe("NovelApplicationShell smoke", () => {
  it("renders the shell and loads the workspace into domains", async () => {
    const { api } = await renderShell();
    expect(screen.getAllByText("白昼计划").length).toBeGreaterThan(0);
    expect(await screen.findByText("还没有对话")).toBeInTheDocument();
    expect(api.conversations.list).toHaveBeenCalledWith({ status: "active" });
    expect(api.novel.overview.get).toHaveBeenCalled();
    expect(api.novel.outline.get).toHaveBeenCalled();
  });

  it("switches to content view and opens the outline unit inspector", async () => {
    const user = userEvent.setup();
    await renderShell();
    await user.click(screen.getByRole("tab", { name: "内容" }));
    expect(await screen.findByText("第一卷：旧船坞")).toBeInTheDocument();
    await user.click(screen.getByText("第一卷：旧船坞"));
    expect(document.querySelector("aside")).not.toBeNull();
    expect(screen.getAllByText("第一卷：旧船坞").length).toBeGreaterThanOrEqual(2);
  });
});
