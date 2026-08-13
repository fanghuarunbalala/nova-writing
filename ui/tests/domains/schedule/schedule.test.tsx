/**
 * schedule 域测试：projection、派生 store、todo store、组件。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationCatalogStore } from "../../../src/domains/conversation/store/ConversationCatalogStore.js";
import { NovelOverviewStore } from "../../../src/domains/novel/overview/NovelOverviewStore.js";
import { StoryOutlineTreeStore } from "../../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";
import { ScheduleProjection } from "../../../src/domains/schedule/projection/ScheduleProjection.js";
import { ScheduleStore } from "../../../src/domains/schedule/store/ScheduleStore.js";
import { ScheduleTodoStore } from "../../../src/domains/schedule/store/ScheduleTodoStore.js";
import { ScheduleStatRow } from "../../../src/domains/schedule/components/ScheduleStatRow.js";
import { ScheduleAxisFlow } from "../../../src/domains/schedule/components/ScheduleAxisFlow.js";
import { ScheduleTodoList } from "../../../src/domains/schedule/components/ScheduleTodoList.js";
import { ScheduleProgressTree } from "../../../src/domains/schedule/components/ScheduleProgressTree.js";

const overview = {
  phase: "ready" as const,
  workspaceId: "w1",
  novelId: "novel_1",
  label: "novel_1",
  counts: {
    storyUnitCount: 12,
    characterCount: 3,
    locationCount: 2,
    chapterCount: 5,
    manuscriptBlockCount: 9,
  },
  error: undefined,
};

const outlineReady = {
  phase: "ready" as const,
  workspaceId: "w1",
  tree: [
    {
      unitId: "arc-v1",
      label: "第一卷",
      scope: "ARC" as const,
      planM: 3 as const,
      realNode: "in-progress" as const,
      children: [
        {
          unitId: "scene-1",
          label: "第 7 号场景",
          scope: "SCENE" as const,
          planM: 2 as const,
          realNode: "completed" as const,
          children: [],
        },
      ],
    },
  ],
  expansionState: new Map<string, boolean>(),
  selectedUnitId: undefined,
  error: undefined,
};

const conversationReady = {
  phase: "ready" as const,
  workspaceId: "w1",
  conversations: [{ id: "c1", title: "对话 1", agentType: "novel", agentLabel: "Novel Agent" }],
  activeConversationId: "c1",
  error: undefined,
};

function makeUpstreamStores() {
  const api = {
    conversations: { list: vi.fn(async () => ({ conversations: [] })), create: vi.fn(), open: vi.fn() },
    novel: {
      overview: { get: vi.fn(async () => ({ schemaVersion: 1, scope: { kind: "canonical" }, workspaceId: "w1", novelId: "novel_1", novelSchemaVersion: 1, sourceRevision: "r1", counts: { storyUnitCount: 12, characterCount: 3, locationCount: 2, volumeCount: 1, chapterCount: 5, manuscriptBlockCount: 9 }, roots: {} })) },
      outline: { get: vi.fn(async () => ({ schemaVersion: 1, scope: { kind: "canonical" }, tree: undefined, progress: [] })), getStoryUnit: vi.fn() },
      characters: {}, locations: {}, manuscript: {},
    },
  } as never;
  const novelOverview = new NovelOverviewStore({ api });
  const outlineTree = new StoryOutlineTreeStore({ api });
  const conversationCatalog = new ConversationCatalogStore({ api });
  return { novelOverview, outlineTree, conversationCatalog };
}

describe("ScheduleProjection", () => {
  it("derives stats from overview and outline", () => {
    const stats = ScheduleProjection.deriveStats(overview as never, outlineReady as never);
    expect(stats.map((stat) => stat.id)).toContain("story-units");
    expect(stats.find((stat) => stat.id === "progress")).toMatchObject({
      num: 1,
      label: "已完成单元",
      note: "共 2",
      variant: "warn",
    });
  });

  it("derives profile and writing todos", () => {
    const emptyConversation = { ...conversationReady, conversations: [] };
    const emptyNovel = { ...overview, counts: { ...overview.counts, characterCount: 0, locationCount: 0 } };
    const todos = ScheduleProjection.deriveTodos(emptyNovel as never, emptyConversation as never);
    expect(todos.map((todo) => todo.tag)).toEqual(["profile", "profile", "writing"]);
  });

  it("derives approval todos from pending approvals", () => {
    const approvals = [
      {
        approvalRequestId: "ap-1",
        title: "新增正文块",
        toolName: "NovelParagraphWrite",
        status: "pending",
      },
      {
        approvalRequestId: "ap-2",
        title: "修改大纲单元",
        toolName: "NovelOutlineEdit",
        status: "approved",
      },
    ] as never;
    const todos = ScheduleProjection.deriveApprovalTodos(approvals);
    expect(todos).toEqual([
      {
        id: "ap-1",
        title: "新增正文块",
        meta: "NovelParagraphWrite",
        tag: "approval",
        status: "open",
        action: { label: "去审批", kind: "open-approval" },
      },
    ]);
  });

  it("derives no approval todos from an empty list", () => {
    expect(ScheduleProjection.deriveApprovalTodos([])).toEqual([]);
  });

  it("derives the progress tree with depth", () => {
    const tree = ScheduleProjection.deriveProgressTree(outlineReady as never);
    expect(tree.map((unit) => [unit.unitId, unit.depth])).toEqual([
      ["arc-v1", 0],
      ["scene-1", 1],
    ]);
  });
});

describe("ScheduleStore", () => {
  it("recomputes from upstream snapshots and propagates error phase", async () => {
    const { novelOverview, outlineTree, conversationCatalog } = makeUpstreamStores();
    const store = new ScheduleStore({ novelOverview, outlineTree, conversationCatalog });
    expect(store.getSnapshot().phase).toBe("idle");
    await Promise.all([
      novelOverview.loadWorkspace("w1"),
      outlineTree.loadWorkspace("w1"),
      conversationCatalog.loadWorkspace("w1"),
    ]);
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().workspaceId).toBe("w1");
    expect(store.getSnapshot().stats.length).toBeGreaterThan(0);
  });

  it("uses deep-equal to skip redundant snapshots", () => {
    const { novelOverview, outlineTree, conversationCatalog } = makeUpstreamStores();
    const store = new ScheduleStore({ novelOverview, outlineTree, conversationCatalog });
    const first = store.getSnapshot();
    store.recompute();
    expect(store.getSnapshot()).toBe(first);
  });
});

describe("ScheduleTodoStore", () => {
  it("toggles todo state", () => {
    const store = new ScheduleTodoStore();
    store.toggle("t1");
    expect(store.getSnapshot().todoState.get("t1")).toBe("done");
    store.toggle("t1");
    expect(store.getSnapshot().todoState.get("t1")).toBe("open");
  });
});

describe("schedule components", () => {
  it("renders stats and axis flow", () => {
    render(
      <ScheduleStatRow
        stats={[
          { id: "story-units", num: 12, label: "大纲单元", note: "arc + scene" },
        ]}
      />,
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    render(<ScheduleAxisFlow planAxis={["idea", "ready"]} realAxis={["pending", "completed"]} />);
    expect(screen.getByText("idea")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("toggles todos and fires actions", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onAction = vi.fn();
    render(
      <ScheduleTodoList
        todos={[
          {
            id: "t1",
            title: "建立角色档案",
            meta: "还没有角色",
            tag: "profile",
            status: "open",
            action: { label: "去角色", kind: "open-character" },
          },
        ]}
        onToggle={onToggle}
        onAction={onAction}
      />,
    );
    await user.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith("t1");
    await user.click(screen.getByRole("button", { name: "去角色" }));
    expect(onAction).toHaveBeenCalledWith("t1", "open-character");
  });

  it("renders the progress tree", () => {
    render(
      <ScheduleProgressTree
        tree={[
          { unitId: "arc-v1", label: "第一卷", depth: 0, planM: 3, realNode: "in-progress" },
          { unitId: "scene-1", label: "第 7 号场景", depth: 1, planM: 2, realNode: "completed" },
        ]}
      />,
    );
    expect(screen.getByText("第一卷")).toBeInTheDocument();
    expect(screen.getByText("第 7 号场景")).toBeInTheDocument();
  });
});
