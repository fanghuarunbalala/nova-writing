/**
 * outline 子域测试：projection、store、组件。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NovelApiClient, StoryOutlineSnapshot, StoryUnit } from "@novel/core";
import { StoryOutlineTreeProjection, composeTitle, hasOrdinalPrefix } from "../../../src/domains/novel/outline/projection/StoryOutlineTreeProjection.js";
import { StoryOutlineTreeStore } from "../../../src/domains/novel/outline/store/StoryOutlineTreeStore.js";
import { StoryOutlineTree } from "../../../src/domains/novel/outline/components/StoryOutlineTree.js";
import { StoryOutlineTreeLegend } from "../../../src/domains/novel/outline/components/StoryOutlineTreeLegend.js";
import { formatSynopsisDisplay } from "../../../src/domains/novel/outline/outlineStatus.js";
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

  it("computes ordinals（全书 / 一、 / 1.1 / 1.1.1，按 orderKey 升序）+ 超深标记", () => {
    const deepUnits: readonly StoryUnit[] = [
      unit({ id: "sg", title: "全书", scope: "saga", orderKey: "0000" }),
      unit({ id: "a1", title: "幕甲", parentId: "sg", scope: "arc", orderKey: "0001" }),
      unit({ id: "a2", title: "幕乙", parentId: "sg", scope: "arc", orderKey: "0002" }),
      // orderKey 乱序插入：序号按 orderKey 排序而非插入序
      unit({ id: "s1", title: "场景一", parentId: "a1", scope: "scene", orderKey: "0002" }),
      unit({ id: "s0", title: "场景零", parentId: "a1", scope: "scene", orderKey: "0001" }),
      unit({ id: "m1", title: "子幕", parentId: "a1", scope: "sequence", orderKey: "0003" }),
      unit({ id: "s1_1", title: "深层场景", parentId: "m1", scope: "scene", orderKey: "0001" }),
      unit({ id: "over", title: "过深", parentId: "s1_1", scope: "custom", orderKey: "0001" }),
    ];
    const tree = StoryOutlineTreeProjection.build(deepUnits);
    const sg = tree[0];
    const [a1, a2] = sg.children;
    expect(sg.ordinal).toBe("全书");
    expect(a1.ordinal).toBe("一");
    expect(a2.ordinal).toBe("二");
    const a1Children = a1.children.map((c) => c.ordinal);
    expect(a1Children).toEqual(["1.1", "1.2", "1.3"]); // s0(0001)/s1(0002)/m1(0003)
    const m1Node = a1.children[2];
    const deep = m1Node.children[0];
    expect(deep.ordinal).toBe("1.3.1");
    expect(deep.overDepth).toBe(false);
    const over = deep.children[0];
    expect(over.ordinal).toBe("1.3.1.1");
    expect(over.overDepth).toBe(true);
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

  it("marks numberedTitle and composeTitle skips dynamic ordinal for prefixed titles", () => {
    const dirtyUnits: readonly StoryUnit[] = [
      unit({ id: "sg", title: "全书", scope: "saga", orderKey: "0000" }),
      // LLM 落库脏数据：title 自带编号前缀
      unit({ id: "a1", title: "一、觉醒与灰雾", parentId: "sg", scope: "arc", orderKey: "0001" }),
      unit({ id: "a2", title: "卷入党事件", parentId: "sg", scope: "arc", orderKey: "0002" }),
      unit({ id: "s1", title: "1.1 穿越苏醒", parentId: "a1", scope: "scene", orderKey: "0001" }),
    ];
    const tree = StoryOutlineTreeProjection.build(dirtyUnits);
    const [a1, a2] = tree[0].children;
    expect(a1.numberedTitle).toBe(true);
    expect(a2.numberedTitle).toBe(false);
    expect(tree[0].children[0].children[0].numberedTitle).toBe(true);
    // 带「三、」动态序号也不双重叠加——修复「三、一、觉醒与灰雾」显示错乱
    expect(composeTitle("三", "一、觉醒与灰雾")).toBe("一、觉醒与灰雾");
    expect(composeTitle("1.2", "1.1 穿越苏醒")).toBe("1.1 穿越苏醒");
    // 无前缀正常叠加
    expect(composeTitle("一", "卷入党事件")).toBe("一、卷入党事件");
    expect(composeTitle("1.1", "穿越苏醒")).toBe("1.1 穿越苏醒");
  });

  it("hasOrdinalPrefix matches prefix variants and tolerates known false positives", () => {
    // 命中：中文序数（含组合）/ 点分数字（有无空格）/ 阿拉伯 + 顿号 / 全角点
    expect(hasOrdinalPrefix("一、觉醒与灰雾")).toBe(true);
    expect(hasOrdinalPrefix("二十一、大结局")).toBe(true);
    expect(hasOrdinalPrefix("1.1 穿越苏醒")).toBe(true);
    expect(hasOrdinalPrefix("1.1穿越苏醒")).toBe(true);
    expect(hasOrdinalPrefix("1、开篇")).toBe(true);
    expect(hasOrdinalPrefix("一．序")).toBe(true);
    // 不误伤：无顿号/点分的纯文字标题
    expect(hasOrdinalPrefix("三体")).toBe(false);
    expect(hasOrdinalPrefix("一秒钟")).toBe(false);
    expect(hasOrdinalPrefix("觉醒之弧")).toBe(false);
    // 已知可容忍的误判：「3.14 的浪漫」形如点分编号 → 不叠加序号（少个前缀，无害不毁内容）
    expect(hasOrdinalPrefix("3.14 的浪漫")).toBe(true);
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

  it("derives entity bindings from leaf plans (character/location → units)", async () => {
    const snapshot: StoryOutlineSnapshot = {
      outline: { id: "outline_1", novelId: "novel_1" },
      units: [
        ...units,
        {
          ...unit({ id: "scene-9", title: "雨夜码头", parentId: "arc-v1", scope: "scene" }),
          leaf: {
            settingMode: "located",
            characters: [{ characterId: "char-a" }, { characterId: "char-b" }],
            locations: [{ locationId: "loc-x" }],
            events: [],
            rhythmBeats: [],
            entityChanges: [],
          },
        },
      ],
    };
    const store = new StoryOutlineTreeStore({ api: buildApi({ get: vi.fn(async () => snapshot) }) });
    await store.loadWorkspace("w1");
    const bindings = store.getSnapshot().bindings;
    expect(bindings.characters.get("char-a")).toEqual(["scene-9"]);
    expect(bindings.characters.get("char-b")).toEqual(["scene-9"]);
    expect(bindings.locations.get("loc-x")).toEqual(["scene-9"]);
    expect(bindings.characters.get("char-missing")).toBeUndefined();
  });

  it("tracks selection and expansion (default expanded on first load)", async () => {
    const store = new StoryOutlineTreeStore({ api: buildApi() });
    await store.loadWorkspace("w1");
    store.selectUnit("scene-1");
    expect(store.getSnapshot().selectedUnitId).toBe("scene-1");
    // 首载默认全展开（demo 口径）
    expect(store.getSnapshot().expansionState.get("arc-v1")).toBe(true);
    store.toggleExpand("arc-v1");
    expect(store.getSnapshot().expansionState.get("arc-v1")).toBe(false);
    store.toggleExpand("arc-v1");
    expect(store.getSnapshot().expansionState.get("arc-v1")).toBe(true);
    store.collapseAll();
    expect(store.getSnapshot().expansionState.get("arc-v1")).toBe(false);
    store.expandAll();
    expect(store.getSnapshot().expansionState.get("arc-v1")).toBe(true);
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
    store.toggleExpand("arc-v1"); // 默认展开 → 收起
    // agent 写入大纲 → invalidate 重拉：用户正看的选中/展开不被清掉
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().selectedUnitId).toBe("scene-1");
    expect(store.getSnapshot().expansionState.get("arc-v1")).toBe(false);
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
    expect(screen.getByText("一、第一卷：旧船坞")).toBeInTheDocument();
    expect(screen.getByText("1.1 第 7 号场景")).toBeInTheDocument();
    // 父单元 scope chip + 进度数字 + 状态 chip（写作中）。
    expect(screen.getByText("幕")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    // 状态 chip（树行与图例都会出现「写作中」）。
    expect(screen.getAllByText("写作中").length).toBeGreaterThan(0);
    // SB-7 口径：阻塞/废弃原因不在树行显示（由单元详情页横幅承载）。
    expect(screen.queryByText(/阻塞：/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "折叠" }));
    expect(onToggleExpand).toHaveBeenCalledWith("arc-v1");
  });

  it("renders dirty numbered titles without ordinal stacking + 「含编号」chip", () => {
    const dirty = [
      unit({ id: "sg", title: "全书", scope: "saga", orderKey: "0000" }),
      unit({ id: "a1", title: "一、觉醒与灰雾", parentId: "sg", scope: "arc", orderKey: "0001" }),
      unit({ id: "s1", title: "1.1 穿越苏醒", parentId: "a1", scope: "scene", orderKey: "0001" }),
    ];
    const tree = StoryOutlineTreeProjection.build(dirty);
    render(
      <StoryOutlineTree
        workspaceId="w1"
        tree={tree}
        expansionState={new Map([["sg", true], ["a1", true]])}
        selectedUnitId="s1"
        onSelectUnit={() => {}}
        onToggleExpand={() => {}}
      />,
    );
    // 游离/带编号 title 不再叠加动态序号（修复「三、一、觉醒与灰雾」双重编号）
    expect(screen.getByText("一、觉醒与灰雾")).toBeInTheDocument();
    expect(screen.getByText("1.1 穿越苏醒")).toBeInTheDocument();
    expect(screen.queryByText(/一、一、/)).not.toBeInTheDocument();
    // 脏数据警示 chip（与「超深」同款）
    expect(screen.getAllByText("含编号").length).toBe(2);
  });

  it("renders legend with hierarchy line and both status axes", () => {
    render(<StoryOutlineTreeLegend />);
    expect(screen.getByText(/全书 → 幕（一、\/ 1.1 \/ 1.1.1，最多 4 层）→ 场景/)).toBeInTheDocument();
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

describe("formatSynopsisDisplay（null 安全与标记脱敏）", () => {
  it("null / undefined 不抛错返回空串（可空列 null 读回的渲染回归）", () => {
    expect(formatSynopsisDisplay(null)).toBe("");
    expect(formatSynopsisDisplay(undefined)).toBe("");
  });

  it("项目导入 imp-b 批次标记脱敏显示", () => {
    expect(formatSynopsisDisplay("开端（覆盖 imp-b000001–imp-b000003）")).toBe(
      "开端（覆盖正文 批次 000001–000003）",
    );
  });
});
