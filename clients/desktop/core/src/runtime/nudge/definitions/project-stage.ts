/**
 * project_stage nudge v2（ContextNudgePolicy 实现，main agent 专属）。
 * docs/PRD/project-stage-nudge.md（v2.0）。
 *
 * 全部注入走 persistent append（用户消息后、落 journal、可审计；求值先于消息
 * 快照——本 call 即可见）。full/sparse 双密度：
 * - full：只注入 nextActionOf 派生的**当前所属工作流**全文 + 路线图 footer +
 *   全局规则 footer；**每种在一个纪元内只出现一次**（策略内集合去重）。
 * - sparse：其余每个用户输入一行心跳（阶段 · 统计 · 下一步指针），不去重。
 *
 * 纪元 = 自上次压缩：compactionGeneration 变化 → 清空集合，下一输入重注当前
 * full；压缩链统一清扫带 nudge 标记的 system 消息（LoopContext.sweepNudgeMessages
 * + T2 摘要输入过滤），保证重注不重复。重启 seed-scan 恢复集合（幂等不重发）。
 * clear 兜底：messages 非空→空 视同纪元重置。查询失败静默跳过下次重试，
 * 绝不阻断 provider call。transient 通道不使用（恒 false）。
 *
 * v2.5 起案例路径不在本 nudge——常驻四份质量规范段尾「参考案例」小节
 * （novelStandards.ts，main 与 Compose 同源）；开书全文以案例文件名引用。
 */
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunProgress } from "../../loop/types.js";
import type { ProviderCall } from "../../provider/types.js";
import type { ContextNudgePolicy } from "../ContextNudgePolicy.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";
import type {
  NovelOverview,
  StoryOutlineSnapshot,
  StoryUnitWithLeaf,
} from "../../../novel/contract/snapshot.js";

/** full 注入标记（压缩清扫/摘要过滤/UI 识别用） */
export const PROJECT_STAGE_NUDGE_FULL = "project_stage_full";
/** sparse 注入标记 */
export const PROJECT_STAGE_NUDGE_SPARSE = "project_stage_sparse";

/** ProjectStageNudgePolicy 构造依赖 */
export interface ProjectStageNudgeDeps {
  /** novel-db 查询客户端（buildNovelAgent 的 opts.handle；结构化便于测试替身） */
  readonly handle: Pick<NovelHandle, "query">;
}

/** 项目阶段（= 工作流种类；full 按「每种每纪元一次」去重） */
export type ProjectStagePhase =
  | "collect"
  | "expand_outline"
  | "write_prose"
  | "complete";

/** 项目状态统计行数据 */
export interface ProjectStageStats {
  /** 树叶子故事总数（忽略 abandoned） */
  readonly totalScenes: number;
  /** 已细化（有 leaf 计划且非 idea，= 不可再分候选） */
  readonly refinedCount: number;
  /** 正文已完成 */
  readonly completedCount: number;
  /** 正文段落总数 */
  readonly paragraphs: number;
}

/** 项目状态分类结果（纯函数产物） */
export interface ProjectStage {
  /** 空项目（无任何故事单元） */
  readonly empty: boolean;
  /** 未细化故事数（树叶子无 leaf 计划或 planningStatus=idea） */
  readonly unrefinedCount: number;
  /** 未写正文故事数（已细化但 realizationStatus≠completed） */
  readonly unwrittenCount: number;
  readonly stats: ProjectStageStats;
}

/** 下一步动作（full 选择与 sparse 指针共用） */
export interface ProjectStageAction {
  readonly workflow: ProjectStagePhase;
  /** 目标故事（expand_outline / write_prose 时携带） */
  readonly target?: { readonly id: string; readonly title: string };
}

/** 树叶子 = 无子节点单元（忽略 abandoned），按 orderKey 排序保证书序确定性 */
function bookOrderedLeaves(units: readonly StoryUnitWithLeaf[]): StoryUnitWithLeaf[] {
  const parentIds = new Set(
    units
      .map((u) => u.parentId)
      .filter((parentId): parentId is NonNullable<typeof parentId> => parentId !== undefined),
  );
  return units
    .filter((u) => !parentIds.has(u.id) && u.realizationStatus !== "abandoned")
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));
}

/** 已细化 = 有 leaf 计划且 planningStatus≠idea（「不可再分 + 5 要素」的判定入口） */
function isRefined(unit: StoryUnitWithLeaf): boolean {
  return unit.leaf !== undefined && unit.planningStatus !== "idea";
}

/**
 * 项目状态分类（纯函数）：计数与统计，供 sparse 心跳渲染
 * @param units outline.get includePlans=true 返回的全部单元
 * @param counts overview.get 计数
 */
export function classifyProjectStage(
  units: readonly StoryUnitWithLeaf[],
  counts: NovelOverview["counts"],
): ProjectStage {
  if (units.length === 0) {
    return {
      empty: true,
      unrefinedCount: 0,
      unwrittenCount: 0,
      stats: {
        totalScenes: 0,
        refinedCount: 0,
        completedCount: 0,
        paragraphs: counts.paragraphs,
      },
    };
  }
  const leaves = bookOrderedLeaves(units);
  let unrefinedCount = 0;
  let completedCount = 0;
  for (const leaf of leaves) {
    if (!isRefined(leaf)) {
      unrefinedCount++;
    } else if (leaf.realizationStatus === "completed") {
      completedCount++;
    }
  }
  const refinedCount = leaves.length - unrefinedCount;
  return {
    empty: false,
    unrefinedCount,
    unwrittenCount: refinedCount - completedCount,
    stats: {
      totalScenes: leaves.length,
      refinedCount,
      completedCount,
      paragraphs: counts.paragraphs,
    },
  };
}

/**
 * 下一步动作派生（纯函数，full 选择与 sparse 指针共用）：
 * 无故事单元 → collect；存在未细化故事 → expand_outline（第一个未细化）；
 * 全部已细化有未写 → write_prose（第一个未写）；全完 → complete
 */
export function nextActionOf(units: readonly StoryUnitWithLeaf[]): ProjectStageAction {
  if (units.length === 0) {
    return { workflow: "collect" };
  }
  const leaves = bookOrderedLeaves(units);
  const firstUnrefined = leaves.find((l) => !isRefined(l));
  if (firstUnrefined !== undefined) {
    return {
      workflow: "expand_outline",
      target: { id: firstUnrefined.id, title: firstUnrefined.title },
    };
  }
  const firstUnwritten = leaves.find((l) => l.realizationStatus !== "completed");
  if (firstUnwritten !== undefined) {
    return {
      workflow: "write_prose",
      target: { id: firstUnwritten.id, title: firstUnwritten.title },
    };
  }
  return { workflow: "complete" };
}

// ── 工作流全文（作者定稿 spec；规范层四段常驻 system prompt，按名引用） ──

const COLLECT_FULL_TEXT = [
  "## 开书推荐工作流：从一句话到吸引人的故事",
  "入口：尚无已确认的故事核（项目可能已有零散设定或旧稿）。",
  "1. 用一次 AskUserQuestion（≤2 问）采集：一句话创意（开放填空，绝不配选项）＋目标篇幅与每章推荐字数（冷启动不带「推荐」）。",
  "2. 根据一句话创意展开，并同用户确认。",
  "3. 确认后，经设计模式按序推进三个阶段；每个阶段都要求用户确认，或用户同意暂时跳过，才能进入下一个阶段：",
  "   3.1 世界观（参考「世界观设计案例.md」）",
  "   3.2 书名和基调",
  "   3.3 主要角色设计（主角和主要配角，参考「人物设计案例.md」）",
  "4. 每个阶段按以下步骤循环，直到用户通过：",
  "   4.1 进入 EnterComposeMode（设计模式），用 AskUserQuestion 补充不明确的信息；",
  "   4.2 信息补充完成后，调用草案创作（Compose）子代理给出候选，再通过 AskUserQuestion 让用户选择候选或提出建议；",
  "   4.3 用户确认后 ExitComposeMode 提交审批；未通过（用户提出修改建议）则回到 4.1-4.2 重新补充信息/出候选，直到用户通过。",
  "5. 三阶段全部确认后，由你整合已确认内容成故事核固化清单，按要求写入 NOVEL.md 或正式稿。",
].join("\n");

const OUTLINE_FULL_TEXT = [
  "## 大纲推荐工作流：逐步细化（故事与场景同构）",
  "入口：NOVEL.md 已固化故事核，或大纲中已存在至少一个故事。",
  "核心：两级细化，按作者意愿推进——幕级拆分（story unit → story unit）：按作者指定范围扩展——横向拆一层（1 → 1.1/1.2/1.3）或纵向深入（1 → 1.1 → 1.1.1）直到最底层场景；层级最多 4 层（全书 → 幕 → 幕 → 场景），最底层场景必须带完整场景设计（leaf 计划）且不得再挂子单元；场景级补全（为最底层场景补全 leaf 计划）：场景是最小单元，是故事核（时间/地点/人物、事件序列、节奏拍、状态变更），按三阶段确认。不要求一次细化完，想到哪细化到哪；**每次扩展前先询问作者本次范围**。",
  "### 一、幕级细化（story unit → story unit）",
  "1. 进入 EnterComposeMode（设计模式），**先经 AskUserQuestion 询问本次扩展范围**（横向拆一层，如 1 → 1.1/1.2/1.3；或纵向深入，如 1 → 1.1 → 1.1.1），并请作者用一句话说明其发展；",
  "2. 扩充这段话，同作者确认；经 AskUserQuestion 获取缺失信息后，派草案创作（Compose）子代理或直接生成候选：将这一幕拆解成更小幕的候选内容，同作者确认；",
  "3. 逐层拆到最底层场景（带完整 leaf 计划）为止，**一次只委派当前一幕，不打包整卷/整批出方案**；作者确认后 ExitComposeMode 提交审批：通过则实施，驳回则等待作者补充信息后重来。",
  "### 二、场景细化（为最底层场景补全 leaf 计划）",
  "1. 进入 EnterComposeMode（设计模式），用几句话采集此故事的发展；",
  "2. 按以下三阶段逐步推进，每个阶段都要求作者确认，或作者明确跳过，才能进入下一阶段：",
  "   2.1 时间和地点、人物（时间序列、地点与人物绑定）；",
  "   2.2 事件序列与节奏拍；",
  "   2.3 状态变更（实体状态变化，连贯性追踪）。",
  "   每阶段内循环：AskUserQuestion 补充信息 → 草案创作（Compose）子代理或直接生成候选 → AskUserQuestion 让作者确定候选或补充信息 → 同作者确认；",
  "3. 三阶段确认后 ExitComposeMode 提交审批：通过则实施，驳回则等待作者补充信息。",
  "每轮检查：相邻串联成立、局部情绪曲线无连续 3 个同强度、无「什么不是好的大纲」任一特征（对照「大纲规范」）。",
  "展示：向作者展示当前大纲——一律用「全书 / 一、 / 1.1 / 1.1.1」编号＋标题指代单元（规则见 NovelRead 的「作者可见文本守则」），不用「第X章」组织，不出现内部词；说明本轮成果用创作语言，不自评质量。",
  "可重复执行：按作者指定范围扩展——横向拆一层或纵向深入任一子块均可，不要求一次细化完，想到哪细化到哪；扩展范围每次由作者指定，**扩展前先询问确认**。",
  "完成标准：只要有一个可用的场景 leaf 计划即视为完成。",
  "批量调整：批量细化与跨卷结构调整同样走设计模式经子代理出方案（设计模式内流程见进入时的注入全文）。",
].join("\n");

const PROSE_FULL_TEXT = [
  "## 正文推荐工作流：为场景设计已定的场景成文",
  "入口：至少一个最底层场景已有完整 leaf 计划（不要求全部细化完）。",
  "1. 经 NovelRead(kind=story_unit, includePlans=true) 按书序（或作者指定范围，如第一卷内）定位第一个未完成场景，读其 leaf 计划（时间/地点/人物/事件序列/节奏拍）与前后场景的情绪标签。",
  "2. 进入 EnterComposeMode（设计模式），按 leaf 计划的事件序列逐步推进，除非用户明确要求，否则每个事件都要求作者确认，确认后才推进下一个事件。对当前事件：",
  "   2.1 如果有不明确的，用 AskUserQuestion 补充信息；",
  "   2.2 自己生成或派草案创作（Compose）子代理生成多个候选，同作者确认；",
  "   2.3 你对照「正文规范」审阅修订后写入设计草稿，并以段落 intensity 自查情绪曲线——**无连续 3 个同强度、峰值成片不孤立**；",
  "   2.4 同作者确认后进入下一事件；",
  "   2.5 **一次只委派当前一个事件，不批量委派**；正文用 ```novel 代码块呈现，引用实体用标签（<character id=\"...\"> 等）。",
  "3. 当前场景的 leaf 计划完成后 ExitComposeMode 提交审批：通过则执行写入——NovelWrite(kind=paragraph) 逐句写入（对话中文双引号、每句一段）、**逐段标注 rhythm/intensity（必填）**，并定稿标 completed；驳回则按用户要求继续修改。",
  "发布层延后：写作中不切章；每完成 10-15 个场景统一组装一次（按情绪节点切章、大弧线归卷），组装结果可调整。",
  "降级：场景设计小问题就地补全；大问题改后重写；故事核根本问题 = 唯一重跑「开书推荐工作流」的情况，必须告知作者原因。",
  "小改直改：措辞/节奏/细节等小改重写可不经设计模式直接改。",
].join("\n");

const COMPLETE_FULL_TEXT = [
  "## 收尾推荐工作流：发布与打磨",
  "入口：全部故事正文完成。",
  "1. 发布组装：chapter 选段成章 + volume 归卷（NovelRead/NovelWrite kind=chapter/volume），判据对照「章卷发布结构规范」。",
  "2. 通读一致性检查：伏笔回收、人物弧光、设定冲突。",
  "3. 可开新卷/新篇：用 NovelWrite(kind=story_unit) 扩展大纲后继续。",
].join("\n");

/** 工作流 → 全文（full 注入体；seed-scan 依 header 前缀反查工作流） */
export const FULL_TEXT_OF: Readonly<Record<ProjectStagePhase, string>> = Object.freeze({
  collect: COLLECT_FULL_TEXT,
  expand_outline: OUTLINE_FULL_TEXT,
  write_prose: PROSE_FULL_TEXT,
  complete: COMPLETE_FULL_TEXT,
});

/** 路线图 footer：四工作流入口条件一行化（随每份 full 注入） */
const ROADMAP_FOOTER = [
  "## 工作流路线图（进入对应阶段时注入一次全文）",
  "- 开书推荐工作流：尚无已确认故事核 —— 采集创意与篇幅，经设计模式按阶段（世界观/书名基调/主要角色）确认并固化故事核（NOVEL.md 或正式稿）。",
  "- 大纲推荐工作流：已有故事核或故事单元 —— 按作者指定范围逐幕细化：幕级拆分到最底层场景（层级最多 4 层），场景按三阶段（时间地点人物 / 事件序列节奏拍 / 状态变更）补全 leaf 计划（不要求一次规划完全书）。",
  "- 正文推荐工作流：已有完整 leaf 计划的场景 —— 按书序（或作者指定范围）逐场景成文。",
  "- 收尾推荐工作流：全部故事完成 —— 发布组装与一致性检查。",
].join("\n");

/** 全局规则 footer（随每份 full 注入） */
const GLOBAL_RULES_FOOTER = [
  "## 全局规则",
  "- 不重复问：作者已给出的信息不再询问。",
  "- 不阻塞：作者拒绝建议或无法回答时，记录决定并标注风险，继续推进。",
  "- 不静默回退：需要重跑上一工作流时必须告知作者原因。",
  "- 种子生长不是回退：后续阶段补充前序信息（含直接修正并告知），不视为流程倒退。",
  "- 逐步展开：规划不要求一次定完；完成一步后给出下一步建议，但**不主动要求作者继续完善**，按作者节奏推进。",
  "- 分节确认：成套设计按小节推进，每节只呈现该节候选（可并列 2-3 个供选），作者确认或修正后才进入下一节，绝不一次输出全套方案——成套输出的纠正成本远高于逐节确认的往返成本。",
  "- 先问后做：动笔/委派前，范围、粒度、情绪走向等返工成本高的设计点先用 AskUserQuestion 与作者确认（一次 ≤2 问，可给 2-3 个候选）；未确认的设计点不得进入草稿创作——蒙头出稿再返工的纠正成本远高于先问的往返成本。",
  "- 不硬写：没有完整场景设计不强行成文；「足够」= 场景设计完整而非完美。",
  "- 情绪优先：一切创作决策以情绪效果为第一判据。",
].join("\n");

/**
 * 工作流 → 案例标签前缀映射已随 v2.5 迁出：案例索引常驻四份质量规范段尾
 * 「参考案例」小节（novelStandards.ts 按 task_type 前缀过滤），nudge 不再承载。
 */

/** 渲染 full 全文（工作流全文 + 路线图 + 全局规则；raw markdown） */
export function renderFullText(action: ProjectStageAction): string {
  return [FULL_TEXT_OF[action.workflow], ROADMAP_FOOTER, GLOBAL_RULES_FOOTER].join("\n\n");
}

/** 渲染 sparse 一行心跳 */
export function renderSparseText(stage: ProjectStage, action: ProjectStageAction): string {
  if (action.workflow === "collect") {
    return "【项目状态】开书 · 尚无已确认故事核 · 下一步：采集一句话创意并固化故事核";
  }
  const s = stage.stats;
  if (action.workflow === "expand_outline") {
    return `【项目状态】大纲细化 · 故事 ${s.refinedCount}/${s.totalScenes} 不可再分、${s.completedCount}/${s.totalScenes} 正文完成 · 下一步：细化「${action.target?.title ?? "第一个未细化故事"}」（拆到最底层场景并补全场景设计）`;
  }
  if (action.workflow === "write_prose") {
    return `【项目状态】撰写正文 · 场景 ${s.completedCount}/${s.totalScenes} 已写完 · 下一步：按书序写「${action.target?.title ?? "第一个未写场景"}」`;
  }
  return `【项目状态】收尾 · 全部 ${s.totalScenes} 个故事已完成 · 下一步：发布组装与一致性检查`;
}

/** full 全文 → 工作流种类（seed-scan 用，按 header 前缀反查） */
function workflowOfFullText(content: string): ProjectStagePhase | undefined {
  for (const workflow of Object.keys(FULL_TEXT_OF) as ProjectStagePhase[]) {
    if (content.startsWith(FULL_TEXT_OF[workflow].split("\n")[0]!)) {
      return workflow;
    }
  }
  return undefined;
}

/**
 * 项目状态工作流引导策略 v2（persistent append full/sparse 双密度；transient 不使用）
 */
export class ProjectStageNudgePolicy implements ContextNudgePolicy {
  private readonly handle: Pick<NovelHandle, "query">;
  /** 本纪元已注入 full 的工作流集合（压缩/清空重置） */
  private readonly injectedWorkflows = new Set<ProjectStagePhase>();
  /** 首次求值 seed-scan 守卫（重启幂等） */
  private seeded = false;
  /** 上次观察的压缩代数（变化 = 纪元重置） */
  private lastCompactionGeneration = 0;
  /** 上次观察的 messages 数（非空→空 = clear 兜底） */
  private lastMessageCount = 0;

  constructor(deps: ProjectStageNudgeDeps) {
    this.handle = deps.handle;
  }

  /**
   * 持久注入（run 首个 provider call，curTurn===0 门控）：
   * 纪元重置检查 → 查询 novel.db → 当前工作流未注入过则 full，否则 sparse。
   * 查询失败静默跳过（集合不变，下次输入重试）
   */
  async persistentNudgeIfNeeded(loop: LoopContext, run: RunProgress): Promise<boolean> {
    if (run.curTurn !== 0) {
      return false;
    }
    this.seedFromRuns(loop);
    const generation = loop.compactionGeneration;
    const messageCount = loop.messages.length;
    const cleared = this.lastMessageCount > 0 && messageCount === 0;
    if (generation !== this.lastCompactionGeneration || cleared) {
      this.injectedWorkflows.clear();
    }
    this.lastCompactionGeneration = generation;
    this.lastMessageCount = messageCount;
    let stage: ProjectStage;
    let action: ProjectStageAction;
    try {
      ({ stage, action } = await this.readState());
    } catch {
      return false;
    }
    if (!this.injectedWorkflows.has(action.workflow)) {
      loop.appendRunMessages([
        {
          role: "system",
          content: renderFullText(action),
          nudge: PROJECT_STAGE_NUDGE_FULL,
        },
      ]);
      this.injectedWorkflows.add(action.workflow);
      return true;
    }
    loop.appendRunMessages([
      { role: "system", content: renderSparseText(stage, action), nudge: PROJECT_STAGE_NUDGE_SPARSE },
    ]);
    return true;
  }

  /** transient 通道不使用（v1 头注机制废弃） */
  transientNudgeIfNeeded(_loop: LoopContext, _run: RunProgress, _call: ProviderCall): boolean {
    return false;
  }

  /** 首次求值：扫描恢复 runs 中本纪元已注入的 full（重启幂等，不重发） */
  private seedFromRuns(loop: LoopContext): void {
    if (this.seeded) {
      return;
    }
    this.seeded = true;
    for (const run of loop.runs) {
      for (const message of run.messages) {
        if (message.role === "system" && message.nudge === PROJECT_STAGE_NUDGE_FULL) {
          const workflow = workflowOfFullText(message.content);
          if (workflow !== undefined) {
            this.injectedWorkflows.add(workflow);
          }
        }
      }
    }
  }

  /** 查询 novel.db：分类 + 下一步动作 */
  private async readState(): Promise<{ stage: ProjectStage; action: ProjectStageAction }> {
    const [overview, outline] = await Promise.all([
      this.handle.query<NovelOverview>({ op: "overview.get" }),
      this.handle.query<StoryOutlineSnapshot>({ op: "outline.get", includePlans: true }),
    ]);
    const units = outline.units as StoryUnitWithLeaf[];
    return {
      stage: classifyProjectStage(units, overview.counts),
      action: nextActionOf(units),
    };
  }
}
