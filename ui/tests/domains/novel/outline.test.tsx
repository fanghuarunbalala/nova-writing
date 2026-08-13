/**
 * outline 子域测试：projection、store、组件。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NovelApiClient, NovelOutlineSnapshot, StoryUnit } from "@novel/core";
import { StoryOutlineTreeProjection } from "../../../src/domains/novel/outline/projection/StoryOutlineTreeProjection.js";
import { StoryOutlineTreeStore } from "../../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";
import { StoryOutlineTree } from "../../../src/domains/novel/outline/components/StoryOutlineTree.js";
import { StoryOutlineTreeStatus } from "../../../src/domains/novel/outline/components/StoryOutlineTreeStatus.js";
import { OutlineBlockNote } from "../../../src/domains/novel/outline/components/OutlineBlockNote.js";

function unit(overrides: Partial<StoryUnit> & { readonly id: string; readonly title: string }): StoryUnit {
  return {
    outlineId: "outline_1",
    orderKey: "0001",
    planningStatus: "ready",
    realizationStatus: "pending",
    ...overrides,
  };
}

const units: readonly StoryUnit[] = [
  unit({ id: "arc-v1", title: "第一卷：旧船坞", scope: "arc" }),
  unit({ id: "scene-1", title: "第 7 号场景", parentId: "arc-v1", scope: "scene", planningStatus: "outlined", realizationStatus: "in-progress" }),
  unit({ id: "scene-2", title: "灯塔", parentId: "arc-v1", scope: "scene", planningStatus: "idea", realizationStatus: "pending", blockState: { reasonCode: "decision-required", note: "需要确认追踪目标", dependencyIds: [], blockedAt: "2026-08-05T00:00:00.000Z" } }),
];

function outlineSnapshot(): NovelOutlineSnapshot {
  return {
    schemaVersion: 1,
    scope: { kind: "canonical" },
    tree: { outline: { id: "outline_1", novelId: "novel_1" }, units },
    progress: [],
  };
}

function buildApi(
  outlineOverrides: Partial<NovelApiClient["novel"]["outline"]> = {},
): NovelApiClient {
  return {
    conversations: {} as never,
    novel: {
      overview: {} as never,
      outline: {
        get: vi.fn(async () => outlineSnapshot()),
        getStoryUnit: vi.fn(),
        ...outlineOverrides,
      },
      characters: {} as never,
      locations: {} as never,
      manuscript: {} as never,
    },
  } as unknown as NovelApiClient;
}

describe("StoryOutlineTreeProjection", () => {
  it("builds a hierarchy and maps plan/real status", () => {
    const tree = StoryOutlineTreeProjection.build(units);
    expect(tree).toHaveLength(1);
    const arc = tree[0];
    expect(arc.scope).toBe("ARC");
    expect(arc.planM).toBe(3);
    expect(arc.children).toHaveLength(2);
    const blocked = arc.children[1];
    expect(blocked.realNode).toBe("blocked");
    expect(blocked.blockedReason).toBe("需要确认追踪目标");
    expect(blocked.planM).toBe(1);
  });

  it("findPath returns the unit path", () => {
    const tree = StoryOutlineTreeProjection.build(units);
    expect(StoryOutlineTreeProjection.findPath(tree, "scene-1")).toEqual(["arc-v1", "scene-1"]);
    expect(StoryOutlineTreeProjection.findPath(tree, "missing")).toBeUndefined();
  });
});

describe("StoryOutlineTreeStore", () => {
  it("loads the outline tree", async () => {
    const api = buildApi();
    const store = new StoryOutlineTreeStore({ api });
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().tree).toHaveLength(1);
  });

  it("tracks selection and expansion", async () => {
    const store = new StoryOutlineTreeStore({ api: buildApi() });
    await store.loadWorkspace("w1");
    store.selectUnit("scene-1");
    expect(store.getSnapshot().selectedUnitId).toBe("scene-1");
    store.toggleExpand("arc-v1");
    expect(store.getSnapshot().expansionState.get("arc-v1")).toBe(true);
    store.collapseAll();
    expect(store.getSnapshot().expansionState.get("arc-v1")).toBe(false);
  });

  it("records errors and supports invalidate", async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(outlineSnapshot());
    const api = buildApi({ get });
    const store = new StoryOutlineTreeStore({ api });
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().phase).toBe("error");
    await store.invalidate();
    expect(store.getSnapshot().phase).toBe("ready");
  });
});

describe("outline components", () => {
  it("renders the tree with statuses and block notes", async () => {
    const user = userEvent.setup();
    const onSelectUnit = vi.fn();
    const onToggleExpand = vi.fn();
    const tree = StoryOutlineTreeProjection.build(units);
    render(
      <StoryOutlineTree
        workspaceId="w1"
        tree={tree}
        expansionState={new Map([["arc-v1", true]])}
        selectedUnitId="scene-1"
        onSelectUnit={onSelectUnit}
        onToggleExpand={onToggleExpand}
      />,
    );
    expect(screen.getByText("第一卷：旧船坞")).toBeInTheDocument();
    expect(screen.getByText("第 7 号场景")).toBeInTheDocument();
    expect(screen.getByText(/阻塞：需要确认追踪目标/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "折叠" }));
    expect(onToggleExpand).toHaveBeenCalledWith("arc-v1");
  });

  it("renders status and block note primitives", () => {
    render(<StoryOutlineTreeStatus planM={3} realNode="completed" />);
    expect(screen.getByTitle("completed")).toBeInTheDocument();
    render(<OutlineBlockNote kind="blocked" reason="等待审批" />);
    expect(screen.getByText(/等待审批/)).toBeInTheDocument();
  });
});
