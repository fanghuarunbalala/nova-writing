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
import type { AgentCaseIndexProvider } from "../../agent/composeGuide/caseIndex.js";
import type { GuideCaseEntry } from "../../agent/composeGuide/types.js";
import { renderAgentCasesIndex } from "../../agent/composeGuide/caseIndex.js";

/** full 注入标记（压缩清扫/摘要过滤/UI 识别用） */
export const PROJECT_STAGE_NUDGE_FULL = "project_stage_full";
/** sparse 注入标记 */
export const PROJECT_STAGE_NUDGE_SPARSE = "project_stage_sparse";

/** ProjectStageNudgePolicy 构造依赖 */
export interface ProjectStageNudgeDeps {
  /** novel-db 查询客户端（buildNovelAgent 的 opts.handle；结构化便于测试替身） */
  readonly handle: Pick<NovelHandle, "query">;
  /**
   * 案例索引提供者（node 层注入：seed + 扫描 .novel/cases）：full 注入时取索引、
   * 按工作流前缀过滤后以「本工作流参考案例」footer 附尾（第九批）。缺省不附。
   */
  readonly caseIndexProvider?: AgentCaseIndexProvider;
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
  "1. 用一次 AskUserQuestion（≤2 问）采集：一句话创意（开放填空，绝不配选项）＋目标篇幅与每章推荐字数（冷启动不带「推荐」）。规划可逐步展开：先固化故事核与创作范围（如先定第一卷），其余后续再说，不要求一次定完全书。",
  "2. **默认经设计模式分节构思**：EnterComposeMode 后把故事构建拆成固定小节逐节推进——① 主角（性格/身份/金手指）② 灵魂设定（创意核心意象）③ 世界观与力量体系 ④ 基调与书名 ⑤ 故事核汇总（NOVEL.md 固化清单）。每节派**草案创作（Compose）子代理**出候选（一次只委派当前小节，prompt 只要求该节内容，节内可并列 2-3 个候选），你审阅修订后写入设计草稿并**只呈现当前一节**，作者确认或修正后才进入下一节，绝不一次输出成套方案；与作者的问答互动必须由你本人完成。",
  "3. 五节逐节确认完毕后 ExitComposeMode 提交审批；经作者批准后，故事核固化清单按要求写入 NOVEL.md 或者正式稿。",
].join("\n");

const OUTLINE_FULL_TEXT = [
  "## 大纲推荐工作流：逐步细化（故事与场景同构）",
  "入口：NOVEL.md 已固化故事核，或大纲中已存在至少一个故事。",
  "核心：一个故事能拆成 ≥2 个各自有独立情绪转折的块就继续拆；拆不动 = 不可再分 —— 推进 planningStatus 到 ready 并补全 leaf 5 要素（人物/地点/事件/转折/情绪）。",
  "1. 经 NovelRead(kind=story_unit, includePlans=true) 识别粒度：不可再分且 5 要素全 → 跳过；不可再分缺要素 → 补全；其余 → 候选拆分。",
  "2. 取一个候选（最靠前或作者指定），**默认经设计模式生成**：EnterComposeMode 后派**草案创作（Compose）子代理**出拆分方案（委派 prompt 写明目标故事、细化范围与串联要求），你审阅修订后写入设计草稿，ExitComposeMode 经作者审批应用。方案形态：每个子故事一句话核心事件＋情绪走向；检查四种串联（因果/情绪对比/悬念牵引/目标递进）。方向性分歧或跨卷大结构先用 AskUserQuestion 确认；零星小调整（如补单个要素）可直接改。",
  "3. 子故事可再拆 → 标记待拆下轮处理；不可再拆 → 补全 5 要素。",
  "4. 每轮检查：相邻串联成立、局部情绪曲线无连续 3 个同强度、无「什么不是好的大纲」任一特征（对照「大纲规范」）。",
  "5. 向作者展示当前大纲（用 saga/arc/sequence/scene 层级表述，不用「第X章」，见「大纲规范·概念边界」），说明本轮成果；可给出下一步建议，**不主动要求继续细化**——是否继续、细化哪里由作者提出。",
  "可重复执行：每次一个或一批故事，不要求一次细化完；作者可指定细化范围（如先细化第一卷），其余后续再说。",
  "完成标准（单个故事）：不可再分＋5 要素全＋前后串联验证；（整体）：全部如此＋情绪曲线有波动＋无坏特征。",
  "种子生长：细化中发现故事核需补充（如加配角承载冲突线）直接补进 NOVEL.md 并告知，不视为回退。",
  "批量细化与跨卷结构调整同样走设计模式经子代理出方案（设计模式内流程见进入时的注入全文）。",
].join("\n");

const PROSE_FULL_TEXT = [
  "## 正文推荐工作流：为不可再分的故事成文",
  "入口：至少一个故事不可再分且 5 要素完整（不要求全部细化完）。",
  "1. 经 NovelRead(kind=story_unit, includePlans=true) 按书序（或作者指定范围，如第一卷内）定位第一个未完成故事，读其 5 要素与前后故事的情绪标签。",
  "2. **默认经设计模式生成**：EnterComposeMode 后派**草案创作（Compose）子代理**成文（委派 prompt 写明目标故事 5 要素、情绪走向与前后衔接），你对照「正文规范」审阅修订后写入设计草稿，ExitComposeMode 经作者审批后写入正式稿定稿。正文用 ```novel 代码块呈现；引用实体用标签（<character id=\"...\"> 等）。小改重写（措辞/节奏/细节）可不经设计模式直接改。",
  "3. 作者审阅三态（对应 ExitComposeMode 审批决议）：通过 → 定稿标 completed；小改（措辞/节奏/细节）→ 当场改再提交；大改（方向/情绪/事件逻辑）→ 改该故事要素后重新成文。最多两轮，仍不满 → 标 blocked，跳下一个故事。",
  "4. 定稿后看下一个故事：已细化 → 继续写；未细化 → 先做一轮「大纲推荐工作流」再回来。",
  "发布层延后：写作中不切章；每完成 10-15 个故事统一组装一次（按情绪节点切章、大弧线归卷），组装结果可调整。",
  "降级：要素小问题就地补全；要素大问题改后重写；故事核根本问题 = 唯一重跑「开书推荐工作流」的情况，必须告知作者原因。",
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
  "- 开书推荐工作流：尚无已确认故事核 —— 采集创意与篇幅，经设计模式构思并固化故事核（NOVEL.md 或正式稿）。",
  "- 大纲推荐工作流：已有故事核或故事单元 —— 按作者指定范围逐步拆分到不可再分并补全 5 要素（不要求一次规划完全书）。",
  "- 正文推荐工作流：已有不可再分且 5 要素完整的故事 —— 按书序（或作者指定范围）逐故事成文。",
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
  "- 不硬写：没有 5 要素不强行成文；「足够」= 5 要素完整而非完美。",
  "- 情绪优先：一切创作决策以情绪效果为第一判据。",
].join("\n");

/**
 * 工作流 → 案例标签前缀（第九批，作者定稿映射）：
 * 开书 = 世界观/人物/总纲；大纲 = 总纲/幕细化/场景；正文 = prose 系；收尾无。
 * 前缀匹配对后续新增案例自动生效（如新加 prose-xxx 摘录自动进正文工作流）。
 */
const CASE_PREFIXES_BY_WORKFLOW: Readonly<Record<ProjectStagePhase, readonly string[]>> =
  Object.freeze({
    collect: ["world-", "character-", "outline-"],
    expand_outline: ["outline-", "act-", "scene-"],
    write_prose: ["prose-"],
    complete: [],
  });

/** 案例 footer 标题（.novel/cases 相对路径，主代理可 Read 对照/委派时点名） */
const CASE_FOOTER_HEADER =
  "## 本工作流参考案例（.novel/cases/，按需 Read 对照；委派 Compose 时可在 prompt 中点名）";

/**
 * 渲染工作流案例 footer（前缀过滤；无匹配/收尾工作流 → 空串不附）
 * @param workflow 工作流种类
 * @param entries 案例条目（已排序）
 * @returns footer 文本；空串 = 不附
 */
export function renderCaseFooter(
  workflow: ProjectStagePhase,
  entries: readonly GuideCaseEntry[],
): string {
  const prefixes = CASE_PREFIXES_BY_WORKFLOW[workflow];
  if (prefixes.length === 0 || entries.length === 0) return "";
  const matched = entries.filter((e) => prefixes.some((p) => e.taskType.startsWith(p)));
  if (matched.length === 0) return "";
  return [CASE_FOOTER_HEADER, renderAgentCasesIndex(matched)].join("\n");
}

/** 渲染 full 全文（工作流全文 + 路线图 + 全局规则 [+ 案例 footer]；raw markdown） */
export function renderFullText(
  action: ProjectStageAction,
  caseEntries?: readonly GuideCaseEntry[],
): string {
  const parts = [FULL_TEXT_OF[action.workflow], ROADMAP_FOOTER, GLOBAL_RULES_FOOTER];
  if (caseEntries !== undefined) {
    const caseFooter = renderCaseFooter(action.workflow, caseEntries);
    if (caseFooter !== "") parts.push(caseFooter);
  }
  return parts.join("\n\n");
}

/** 渲染 sparse 一行心跳 */
export function renderSparseText(stage: ProjectStage, action: ProjectStageAction): string {
  if (action.workflow === "collect") {
    return "【项目状态】开书 · 尚无已确认故事核 · 下一步：采集一句话创意并固化故事核";
  }
  const s = stage.stats;
  if (action.workflow === "expand_outline") {
    return `【项目状态】大纲细化 · 故事 ${s.refinedCount}/${s.totalScenes} 不可再分、${s.completedCount}/${s.totalScenes} 正文完成 · 下一步：细化「${action.target?.title ?? "第一个未细化故事"}」（拆分到不可再分并补全 5 要素）`;
  }
  if (action.workflow === "write_prose") {
    return `【项目状态】撰写正文 · 故事 ${s.completedCount}/${s.totalScenes} 已写完 · 下一步：按书序写「${action.target?.title ?? "第一个未写故事"}」`;
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
  /** 案例索引提供者（缺省无——full 不附案例 footer） */
  private readonly caseIndexProvider: AgentCaseIndexProvider | undefined;
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
    this.caseIndexProvider = deps.caseIndexProvider;
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
          content: renderFullText(action, await this.readCaseEntries()),
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

  /** 取案例索引（provider 缺失/异常 → undefined 不附 footer；不阻断 full 注入） */
  private async readCaseEntries(): Promise<readonly GuideCaseEntry[] | undefined> {
    if (this.caseIndexProvider === undefined) return undefined;
    try {
      return await this.caseIndexProvider();
    } catch {
      return undefined;
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
