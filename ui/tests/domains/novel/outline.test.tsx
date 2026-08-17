/**
 * outline 子域测试：projection、store、组件。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NovelApiClient, StoryOutlineSnapshot, StoryUnit } from "@novel/core";
import { StoryOutlineTreeProjection } from "../../../src/domains/novel/outline/projection/StoryOutlineTreeProjection.js";
import { StoryOutlineTreeStore } from "../../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";
import { StoryOutlineTree } from "../../../src/domains/novel/outline/components/StoryOutlineTree.js";
import { StoryOutlineTreeLegend } from "../../../src/domains/novel/outline/components/StoryOutlineTreeLegend.js";
import { OutlineUnitInspectorPanel } from "../../../src/shell/inspector/panels/OutlineUnitInspectorPanel.js";
import { StatusChip } from "../../../src/shared/primitives/StatusChip.js";

function unit(overrides: Partial<StoryUnit> & { readonly id: string; readonly title: string }): StoryUnit {
  return {
    outlineId: "outline_1",
    orderKey: "0001",
    entityVersion: 1,
    planningStatus: "ready",
    realizationStatus: "pending",
    ...overrides,
  };
}

const units: readonly StoryUnit[] = [
  unit({ id: "arc-v1", title: "第一卷：旧船坞", scope: "arc" }),
  unit({ id: "scene-1", title: "第 7 号场景", parentId: "arc-v1", scope: "scene", planningStatus: "outlined", realizationStatus: "in-progress" }),
  unit({ id: "scene-2", title: "灯塔", parentId: "arc-v1", scope: "scene", planningStatus: "idea", realizationStatus: "pending", blockState: { reasonCode: "decision-required", note: "需要确认追踪目标", dependencyIds: [] } }),
];

function outlineSnapshot(): StoryOutlineSnapshot {
  return {
    outline: { id: "outline_1", novelId: "novel_1" },
    units,
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
  it("builds a hierarchy and maps plan/real status with core scopes", () => {
    const tree = StoryOutlineTreeProjection.build(units);
    expect(tree).toHaveLength(1);
    const arc = tree[0];
    expect(arc.scope).toBe("arc");
    expect(arc.planningStatus).toBe("ready");
    expect(arc.children).toHaveLength(2);
    const scene = arc.children[0];
    expect(scene.realization).toBe("in-progress");
    expect(scene.depth).toBe(1);
    expect(scene.parentTitle).toBe("第一卷：旧船坞");
    const blocked = arc.children[1];
    // blocked 为派生态：pending + blockState。
    expect(blocked.realization).toBe("blocked");
    expect(blocked.blockedReason).toBe("需要确认追踪目标");
    expect(blocked.planningStatus).toBe("idea");
  });

  it("keeps includePlans rollup as progress and counts all units", () => {
    const withRollup = [
      unit({ id: "sg", title: "全书", scope: "saga", orderKey: "0000" }),
      {
        ...unit({ id: "leaf-1", parentId: "sg", title: "场景一", scope: "scene", orderKey: "0001" }),
        progress: { effectiveStatus: "in-progress", isBlocked: false, completedLeafCount: 2, totalLeafCount: 5 },
      },
    ];
    const tree = StoryOutlineTreeProjection.build(withRollup);
    expect(tree[0].children[0].progress).toEqual({ completed: 2, total: 5 });
    expect(StoryOutlineTreeProjection.countAll(tree)).toBe(2);
  });

  it("falls back missing scope to custom", () => {
    const tree = StoryOutlineTreeProjection.build([unit({ id: "u", title: "未标" })]);
    expect(tree[0].scope).toBe("custom");
  });

  it("findPath returns the unit path", () => {
    const tree = StoryOutlineTreeProjection.build(units);
    expect(StoryOutlineTreeProjection.findPath(tree, "scene-1")).toEqual(["arc-v1", "scene-1"]);
    expect(StoryOutlineTreeProjection.findPath(tree, "missing")).toBeUndefined();
  });
});

describe("StoryOutlineTreeStore", () => {
  it("loads the outline tree with includePlans", async () => {
    const get = vi.fn(async () => outlineSnapshot());
    const api = buildApi({ get });
    const store = new StoryOutlineTreeStore({ api });
    await store.loadWorkspace("w1");
    expect(get).toHaveBeenCalledWith({ includePlans: true });
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

  it("事件失效重载保留选中与展开（单元仍在时）；单元被删则清空选中", async () => {
    let current = outlineSnapshot();
    const get = vi.fn(async () => current);
    const store = new StoryOutlineTreeStore({ api: buildApi({ get }) });
    await store.loadWorkspace("w1");
    store.selectUnit("scene-1");
    store.toggleExpand("arc-v1");
    // agent 写入大纲 → invalidate 重拉：用户正看的选中/展开不被清掉
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().selectedUnitId).toBe("scene-1");
    expect(store.getSnapshot().expansionState.get("arc-v1")).toBe(true);
    // 选中单元在重放数据中不存在（被删）→ 清空
    current = {
      outline: { id: "outline_1", novelId: "novel_1" },
      units: [unit({ id: "arc-v1", title: "第一卷：旧船坞", scope: "arc" })],
    };
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().selectedUnitId).toBeUndefined();
  });

  it("同工作区重载（事件失效刷新）loading 期不闪空：保留现有树与选中", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(outlineSnapshot())
      .mockImplementationOnce(() => new Promise<StoryOutlineSnapshot>(() => {})); // 第二次拉取挂起
    const store = new StoryOutlineTreeStore({ api: buildApi({ get }) });
    await store.loadWorkspace("w1");
    store.selectUnit("scene-1");
    void store.loadWorkspace("w1"); // 重载挂起中
    const snapshot = store.getSnapshot();
    expect(snapshot.phase).toBe("loading");
    expect(snapshot.tree).toHaveLength(1); // 不闪回空初始态
    expect(snapshot.selectedUnitId).toBe("scene-1");
  });
});

describe("outline components", () => {
  it("renders the tree with status chips and progress, without block notes", async () => {
    const user = userEvent.setup();
    const onSelectUnit = vi.fn();
    const onToggleExpand = vi.fn();
    const withProgress = [
      { ...units[0], progress: { effectiveStatus: "in-progress", isBlocked: false, completedLeafCount: 1, totalLeafCount: 2 } },
      ...units.slice(1),
    ];
    const tree = StoryOutlineTreeProjection.build(withProgress);
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
    // 父单元 scope chip + 进度数字 + 状态 chip（写作中）。
    expect(screen.getByText("卷")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    // 状态 chip（树行与图例都会出现「写作中」）。
    expect(screen.getAllByText("写作中").length).toBeGreaterThan(0);
    // SB-7 口径：阻塞/废弃原因不在树行显示（由单元详情页横幅承载）。
    expect(screen.queryByText(/阻塞：/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "折叠" }));
    expect(onToggleExpand).toHaveBeenCalledWith("arc-v1");
  });

  it("renders legend with hierarchy line and both status axes", () => {
    render(<StoryOutlineTreeLegend />);
    expect(screen.getByText(/saga 全书 → arc 卷/)).toBeInTheDocument();
    expect(screen.getByText("规划")).toBeInTheDocument();
    expect(screen.getByText("实现")).toBeInTheDocument();
    for (const label of ["点子", "已成纲", "可开写", "未动笔", "写作中", "已完成", "受阻", "废弃"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders status chip primitive", () => {
    render(<StatusChip variant="success">已完成</StatusChip>);
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });
});

describe("OutlineUnitInspectorPanel 单元段落卡", () => {
  it("renders unit paragraphs with publish status chips and empty state", async () => {
    const store = new StoryOutlineTreeStore({ api: buildApi() });
    await store.loadWorkspace("w1");
    store.selectUnit("scene-1");
    const view = (unitParagraphs: readonly { paragraphId: string; text: string; textLength: number; entityVersion: number }[]) => (
      <OutlineUnitInspectorPanel
        workspaceId="w1"
        unitId="scene-1"
        outlineTree={store}
        unitParagraphs={unitParagraphs}
        publishedParagraphIds={new Set(["para_a"])}
      />
    );
    const { rerender } = render(view([
      { paragraphId: "para_a", text: "已入选章选择的段落。", textLength: 10, entityVersion: 1 },
      { paragraphId: "para_b", text: "挂在单元下但尚未进入任何章选择的段落。", textLength: 20, entityVersion: 1 },
    ]));
    expect(screen.getByText("单元段落 · 2")).toBeInTheDocument();
    expect(screen.getByText(/已入选章选择的段落。/)).toBeInTheDocument();
    expect(screen.getByText(/挂在单元下但尚未进入任何章选择的段落。/)).toBeInTheDocument();
    expect(screen.getByText("已入选章")).toBeInTheDocument();
    expect(screen.getByText("未发布")).toBeInTheDocument();
    // 空态：引导到对话写入
    rerender(view([]));
    expect(screen.getByText(/暂无段落/)).toBeInTheDocument();
  });
});
