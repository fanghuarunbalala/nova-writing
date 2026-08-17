import { describe, it, expect, vi } from "vitest";
import {
  ProjectStageNudgePolicy,
  PROJECT_STAGE_NUDGE_FULL,
  PROJECT_STAGE_NUDGE_SPARSE,
  FULL_TEXT_OF,
  classifyProjectStage,
  nextActionOf,
  renderFullText,
  renderSparseText,
} from "../project-stage.js";
import type { LoopContext } from "../../../loop/LoopContext.js";
import type { RunProgress } from "../../../loop/types.js";
import type {
  NovelOverview,
  StoryOutlineSnapshot,
  StoryUnitWithLeaf,
} from "../../../../novel/contract/snapshot.js";
import type {
  LeafPlan,
  OrderKey,
  StoryOutlineId,
  StoryUnitId,
  StoryUnitPlanningStatus,
  StoryUnitRealizationStatus,
} from "../../../../novel/model/outline.js";
import type { NovelId } from "../../../../novel/model/id.js";

function unit(opts: {
  id: string;
  parentId?: string;
  orderKey?: string;
  planningStatus?: StoryUnitPlanningStatus;
  realizationStatus?: StoryUnitRealizationStatus;
  withLeaf?: boolean;
}): StoryUnitWithLeaf {
  const base = {
    id: opts.id as StoryUnitId,
    entityVersion: 1,
    outlineId: "outline_1" as StoryOutlineId,
    ...(opts.parentId === undefined ? {} : { parentId: opts.parentId as StoryUnitId }),
    orderKey: (opts.orderKey ?? "0001") as OrderKey,
    title: opts.id,
    planningStatus: opts.planningStatus ?? "idea",
    realizationStatus: opts.realizationStatus ?? "pending",
  };
  return opts.withLeaf === true ? { ...base, leaf: leafPlan() } : base;
}

function leafPlan(): LeafPlan {
  return {
    settingMode: "located",
    characters: [],
    locations: [],
    events: [],
    rhythmBeats: [],
    entityChanges: [],
  };
}

function counts(overrides: Partial<NovelOverview["counts"]> = {}): NovelOverview["counts"] {
  return {
    storyUnits: 0,
    characters: 0,
    locations: 0,
    volumes: 0,
    chapters: 0,
    paragraphs: 0,
    ...overrides,
  };
}

/** overview/outline 查询应答对 */
function snapshotPair(units: StoryUnitWithLeaf[], paragraphs = 0) {
  const overview: NovelOverview = {
    novelId: "novel_1" as NovelId,
    title: "未命名小说",
    counts: counts({ storyUnits: units.length, paragraphs }),
  };
  const outline = {
    outline: { id: "outline_1" as StoryOutlineId, novelId: "novel_1" as NovelId },
    units,
  } as unknown as StoryOutlineSnapshot;
  return { overview, outline };
}

/** 可切换状态的 handle（场景推演用） */
function statefulHandle() {
  let units: StoryUnitWithLeaf[] = [];
  let paragraphs = 0;
  const query = vi.fn(async (q: { op: string }) => {
    const { overview, outline } = snapshotPair(units, paragraphs);
    return q.op === "overview.get" ? overview : outline;
  });
  return {
    query,
    set(next: StoryUnitWithLeaf[], paras = 0) {
      units = next;
      paragraphs = paras;
    },
  };
}

type AppendedMessage = { role: "system"; content: string; nudge?: string };

function mockLoop(opts: {
  generation?: number;
  messages?: Array<{ role: string; content: string }>;
  runs?: Array<{ messages: Array<{ role: string; content: string; nudge?: string }> }>;
} = {}) {
  const appended: AppendedMessage[] = [];
  const loop = {
    compactionGeneration: opts.generation ?? 0,
    messages: opts.messages ?? [{ role: "user", content: "hi" }],
    runs: (opts.runs ?? [{ messages: [{ role: "user", content: "hi" }] }]).map((r) => ({
      messages: [...r.messages],
    })),
    appendRunMessages: vi.fn((ms: AppendedMessage[]) => {
      appended.push(...ms);
    }),
  } as unknown as LoopContext;
  return { loop, appended };
}

function run(curTurn = 0): RunProgress {
  return { curTurn, maxTurn: 100, toolsLastTurn: new Map() };
}

describe("classifyProjectStage", () => {
  it("空项目：units 为空 → empty", () => {
    const stage = classifyProjectStage([], counts({ paragraphs: 3 }));
    expect(stage.empty).toBe(true);
    expect(stage.stats.paragraphs).toBe(3);
  });

  it("树叶子无 leaf 计划或仍是 idea → 未细化；父单元不计；abandoned 排除", () => {
    const units = [
      unit({ id: "root", orderKey: "0001", planningStatus: "ready", withLeaf: true }),
      unit({ id: "a", parentId: "root", orderKey: "0001", planningStatus: "outlined" }),
      unit({ id: "b", parentId: "root", orderKey: "0002", planningStatus: "idea", withLeaf: true }),
      unit({ id: "c", parentId: "root", orderKey: "0003", realizationStatus: "abandoned" }),
    ];
    const stage = classifyProjectStage(units, counts());
    expect(stage.unrefinedCount).toBe(2);
    expect(stage.unwrittenCount).toBe(0);
    expect(stage.stats.totalScenes).toBe(2); // 父单元与 abandoned 不计
  });

  it("已细化未写正文 → unwritten；已写完 → completed", () => {
    const units = [
      unit({
        id: "a",
        orderKey: "0001",
        planningStatus: "ready",
        realizationStatus: "pending",
        withLeaf: true,
      }),
      unit({
        id: "b",
        orderKey: "0002",
        planningStatus: "ready",
        realizationStatus: "completed",
        withLeaf: true,
      }),
    ];
    const stage = classifyProjectStage(units, counts());
    expect(stage.unrefinedCount).toBe(0);
    expect(stage.unwrittenCount).toBe(1);
    expect(stage.stats.refinedCount).toBe(2);
    expect(stage.stats.completedCount).toBe(1);
  });
});

describe("nextActionOf", () => {
  it("空 → collect", () => {
    expect(nextActionOf([])).toEqual({ workflow: "collect" });
  });

  it("存在未细化故事 → expand_outline，目标为书序第一个未细化", () => {
    const units = [
      unit({
        id: "done",
        orderKey: "0001",
        planningStatus: "ready",
        realizationStatus: "completed",
        withLeaf: true,
      }),
      unit({ id: "later", orderKey: "0003", planningStatus: "outlined" }),
      unit({ id: "first-todo", orderKey: "0002", planningStatus: "outlined" }),
    ];
    const action = nextActionOf(units);
    expect(action.workflow).toBe("expand_outline");
    expect(action.target).toEqual({ id: "first-todo", title: "first-todo" });
  });

  it("全部已细化有未写 → write_prose；全完 → complete", () => {
    const refinedPending = [
      unit({
        id: "a",
        orderKey: "0001",
        planningStatus: "ready",
        realizationStatus: "pending",
        withLeaf: true,
      }),
    ];
    expect(nextActionOf(refinedPending).workflow).toBe("write_prose");
    const allDone = [
      unit({
        id: "a",
        orderKey: "0001",
        planningStatus: "ready",
        realizationStatus: "completed",
        withLeaf: true,
      }),
    ];
    expect(nextActionOf(allDone).workflow).toBe("complete");
  });
});

describe("renderFullText / renderSparseText", () => {
  it("full = 工作流全文 + 路线图 + 全局规则", () => {
    const text = renderFullText({ workflow: "expand_outline" });
    expect(text.startsWith("## 大纲推荐工作流")).toBe(true);
    expect(text).toContain("## 工作流路线图");
    expect(text).toContain("## 全局规则");
    expect(text).toContain("情绪优先");
  });

  it("开书 full 按作者定稿：创意+目标字数+每章推荐字数，确认后写入 NOVEL.md 或正式稿", () => {
    const text = FULL_TEXT_OF.collect;
    expect(text.startsWith("## 开书推荐工作流")).toBe(true);
    expect(text).toContain("一句话创意（开放填空，绝不配选项）");
    expect(text).toContain("全篇目标字数及每章推荐字数");
    expect(text).toContain("帮助用户完成一个吸引人的故事构建");
    expect(text).toContain("写入 NOVEL.md 或者正式稿");
  });

  it("正文 full 含三态审阅 / 两轮上限 / 发布延后", () => {
    const text = FULL_TEXT_OF.write_prose;
    expect(text).toContain("通过 → 定稿标 completed");
    expect(text).toContain("最多两轮");
    expect(text).toContain("每完成 10-15 个故事统一组装");
  });

  it("sparse：各阶段一行，指针带目标", () => {
    expect(renderSparseText(classifyProjectStage([], counts()), { workflow: "collect" })).toContain(
      "【项目状态】开书",
    );
    const units = [
      unit({
        id: "a",
        orderKey: "0001",
        planningStatus: "ready",
        realizationStatus: "completed",
        withLeaf: true,
      }),
      unit({ id: "b", orderKey: "0002", planningStatus: "outlined" }),
    ];
    const stage = classifyProjectStage(units, counts({ paragraphs: 9 }));
    const action = nextActionOf(units);
    const sparse = renderSparseText(stage, action);
    expect(sparse).toContain("【项目状态】大纲细化");
    expect(sparse).toContain("1/2 不可再分");
    expect(sparse).toContain("细化「b」");
  });
});

describe("ProjectStageNudgePolicy v2（persistent full/sparse）", () => {
  it("首 run：append full（标记 project_stage_full，含全文+双 footer）", async () => {
    const handle = statefulHandle();
    const policy = new ProjectStageNudgePolicy({ handle });
    const { loop, appended } = mockLoop();
    expect(await policy.persistentNudgeIfNeeded(loop, run())).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ role: "system", nudge: PROJECT_STAGE_NUDGE_FULL });
    expect(appended[0]!.content).toContain("## 开书推荐工作流");
    expect(appended[0]!.content).toContain("## 全局规则");
    expect(policy.transientNudgeIfNeeded(loop, run(), { system: "", tools: [], messages: [], sampling: { model: "gpt-5" } })).toBe(false);
  });

  it("同工作流第二个 run：sparse 一行（无 footer）", async () => {
    const handle = statefulHandle();
    const policy = new ProjectStageNudgePolicy({ handle });
    const first = mockLoop();
    await policy.persistentNudgeIfNeeded(first.loop, run());
    const second = mockLoop();
    expect(await policy.persistentNudgeIfNeeded(second.loop, run())).toBe(true);
    expect(second.appended[0]).toMatchObject({ nudge: PROJECT_STAGE_NUDGE_SPARSE });
    expect(second.appended[0]!.content).toContain("【项目状态】开书");
    expect(second.appended[0]!.content).not.toContain("## 全局规则");
  });

  it("工作流切换：新工作流注入其 full 一次；回退到已注入工作流只给 sparse", async () => {
    const handle = statefulHandle();
    const policy = new ProjectStageNudgePolicy({ handle });
    await policy.persistentNudgeIfNeeded(mockLoop().loop, run()); // collect full
    handle.set([unit({ id: "s1", orderKey: "0001", planningStatus: "outlined" })]);
    const outlineRun = mockLoop();
    await policy.persistentNudgeIfNeeded(outlineRun.loop, run()); // outline full
    expect(outlineRun.appended[0]!.nudge).toBe(PROJECT_STAGE_NUDGE_FULL);
    expect(outlineRun.appended[0]!.content).toContain("## 大纲推荐工作流");
    // 同工作流再次 → sparse
    const outlineAgain = mockLoop();
    await policy.persistentNudgeIfNeeded(outlineAgain.loop, run());
    expect(outlineAgain.appended[0]!.nudge).toBe(PROJECT_STAGE_NUDGE_SPARSE);
    // 回退到 collect（清空大纲）→ 已注入过，sparse
    handle.set([]);
    const back = mockLoop();
    await policy.persistentNudgeIfNeeded(back.loop, run());
    expect(back.appended[0]!.nudge).toBe(PROJECT_STAGE_NUDGE_SPARSE);
  });

  it("curTurn>0（run 内非首调用）：不注入", async () => {
    const handle = statefulHandle();
    const policy = new ProjectStageNudgePolicy({ handle });
    const { loop, appended } = mockLoop();
    expect(await policy.persistentNudgeIfNeeded(loop, run(2))).toBe(false);
    expect(appended).toHaveLength(0);
  });

  it("压缩代数变化：纪元归零，当前工作流重注 full", async () => {
    const handle = statefulHandle();
    const policy = new ProjectStageNudgePolicy({ handle });
    await policy.persistentNudgeIfNeeded(mockLoop({ generation: 0 }).loop, run()); // full
    await policy.persistentNudgeIfNeeded(mockLoop({ generation: 0 }).loop, run()); // sparse
    const postCompact = mockLoop({ generation: 1 });
    await policy.persistentNudgeIfNeeded(postCompact.loop, run());
    expect(postCompact.appended[0]!.nudge).toBe(PROJECT_STAGE_NUDGE_FULL);
    expect(postCompact.appended[0]!.content).toContain("## 开书推荐工作流");
  });

  it("查询失败：本次静默不注入；恢复后下次 run 补 full", async () => {
    const query = vi.fn(async () => {
      throw new Error("rpc down");
    });
    const policy = new ProjectStageNudgePolicy({ handle: { query } });
    const failed = mockLoop();
    await expect(policy.persistentNudgeIfNeeded(failed.loop, run())).resolves.toBe(false);
    expect(failed.appended).toHaveLength(0);
    const { overview, outline } = snapshotPair([]);
    query.mockImplementation(async (q: { op: string }) =>
      q.op === "overview.get" ? overview : outline,
    );
    const recovered = mockLoop();
    expect(await policy.persistentNudgeIfNeeded(recovered.loop, run())).toBe(true);
    expect(recovered.appended[0]!.nudge).toBe(PROJECT_STAGE_NUDGE_FULL);
  });

  it("seed-scan：恢复 runs 已有当前工作流 full → 重启不重发（直接 sparse）", async () => {
    const handle = statefulHandle();
    const policy = new ProjectStageNudgePolicy({ handle });
    const restored = mockLoop({
      runs: [
        {
          messages: [
            { role: "user", content: "你好" },
            { role: "system", content: FULL_TEXT_OF.collect, nudge: PROJECT_STAGE_NUDGE_FULL },
            { role: "assistant", content: "好的" },
          ],
        },
      ],
    });
    expect(await policy.persistentNudgeIfNeeded(restored.loop, run())).toBe(true);
    expect(restored.appended[0]!.nudge).toBe(PROJECT_STAGE_NUDGE_SPARSE);
  });

  it("clear 兜底：messages 非空→空，视同纪元重置重注 full", async () => {
    const handle = statefulHandle();
    const policy = new ProjectStageNudgePolicy({ handle });
    await policy.persistentNudgeIfNeeded(
      mockLoop({ messages: [{ role: "user", content: "hi" }] }).loop,
      run(),
    ); // full（lastMessageCount=1）
    const cleared = mockLoop({ messages: [] });
    await policy.persistentNudgeIfNeeded(cleared.loop, run());
    expect(cleared.appended[0]!.nudge).toBe(PROJECT_STAGE_NUDGE_FULL);
  });
});
