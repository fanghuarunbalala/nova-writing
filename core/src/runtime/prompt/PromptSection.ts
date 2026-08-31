import type { ReadonlyLoopContext } from "../loop/LoopContext.js";
import type { GuideCaseEntry } from "../agent/composeGuide/types.js";

/**
 * 小说全局约束快照（分层，PRD memory-两层记忆 M1）：node 层每调用读取两层
 * NOVEL.md 注入（各 ≤256 KiB，超限整体拒绝）。拼接序 = 全局层在前、项目层在后，
 * 优先级项目层 > 全局层（软优先级：渲染标注引导，不做硬消解）。
 * Layered novel global-constraints snapshot (PRD memory two-layer): the node
 * layer reads both NOVEL.md files per call (each ≤256 KiB, over-limit rejected
 * whole). Concatenation order = global first, project after; project layer
 * takes soft precedence over the global layer.
 */
export interface NovelGlobalConstraintsSnapshot {
  /** 全局层内容（用户数据目录 NOVEL.md；缺失 = 未声明，不渲染该层） */
  readonly global?: string;
  /** 项目层内容（workspace 根 NOVEL.md；缺失 = 未声明，不渲染该层） */
  readonly project?: string;
}

/**
 * 案例引导快照：node 层扫描 workspace `.novel/cases` 派生（PRD compose-案例引导）。
 * 承载结构化案例条目，由四份质量规范段（main 与 Compose 共享）按各自 task_type
 * 前缀过滤渲染「参考案例」小节；选中正文仍以 `<novel-guide>` 消息注入（不走动态段）。
 * Case guide snapshot: derived by the node layer from scanning the workspace
 * `.novel/cases` directory. Carries structured entries consumed by the four
 * quality-standard sections (shared by main and Compose), each filtering by
 * its own task_type prefixes to render a "reference cases" subsection;
 * selected case bodies are injected as a `<novel-guide>` message instead.
 */
export interface CaseGuideSnapshot {
  /** 案例条目（已按 order/文件名序） */
  readonly entries: readonly GuideCaseEntry[];
  /** 案例目录（workspace 相对路径，恒 ".novel/cases"） */
  readonly casesDir: string;
}

/**
 * 技能索引快照：会话启动时由宿主从 SkillRegistry.effective() 派生一次
 * （会话期静态，非每调用读盘），skill.index 动态段渲染渐进披露第一层。
 * Skills index snapshot: derived once at conversation start by the host from
 * SkillRegistry.effective() (conversation-static, not read per call); the
 * skill.index dynamic section renders the first progressive-disclosure layer.
 */
export interface SkillsIndexSnapshot {
  /** 生效技能条目（仅 name + description，不含路径与正文） */
  readonly entries: readonly {
    /** 技能名 */
    readonly name: string;
    /** 简介 */
    readonly description: string;
  }[];
}

/**
 * 动态记忆索引快照（PRD memory-两层记忆 M2）：node 层每调用读 memory/MEMORY.md
 * 派生（active 条目，注入预算内截断）。Compose 侧提供者按 type 过滤
 * （author/feedback），过滤发生在提供者而非渲染层。
 * Dynamic memory-index snapshot: derived per call by the node layer from
 * memory/MEMORY.md (active entries, truncated to the injection budget). The
 * Compose-side provider filters by type (author/feedback) at the provider,
 * not in rendering.
 */
export interface MemoryIndexSnapshot {
  /** 索引行（active 条目，已按确定序：type 分组 → name 字典序） */
  readonly entries: readonly {
    /** 主题名（kebab-case，= memory/<name>.md 文件名） */
    readonly name: string;
    /** 一句话描述（检索锚点） */
    readonly description: string;
    /** 条目类型 */
    readonly type: "author" | "feedback" | "project" | "reference";
  }[];
  /** 注入预算（200 行）截断掉了尾部条目（磁盘文件完整） */
  readonly truncated: boolean;
}

/**
 * 动态段渲染输入：LoopContext 每 provider call 组装（workdir/platform/modelId
 * 来自 LoopContext 自身状态与 run 配置），仅 novelGlobalConstraints 由宿主注入。
 * Dynamic section render input: assembled per provider call by LoopContext
 * (workdir/platform/modelId come from LoopContext's own state and the run
 * config); only novelGlobalConstraints is host-injected.
 */
export interface DynamicPromptSectionInput {
  /** 环境快照：workdir=ctx.workspace、platform=构造注入常量、modelId=run.sampling.model */
  readonly environment?: {
    /** 工作目录 */
    readonly workdir: string;
    /** 平台显示名（宿主注入） */
    readonly platform: string;
    /** 模型 id（LoopContext 以 run.sampling.model 补齐） */
    readonly modelId?: string;
  };
  /** 小说全局约束快照（宿主每调用注入；缺失时动态段渲染占位） */
  readonly novelGlobalConstraints?: NovelGlobalConstraintsSnapshot;
  /** 案例引导快照（宿主每调用注入；缺失时规范段仅省略「参考案例」小节） */
  readonly caseGuide?: CaseGuideSnapshot;
  /** 技能索引快照（宿主装配期注入一次、会话期静态；缺失或空时 skill.index 段省略） */
  readonly skills?: SkillsIndexSnapshot;
  /** 动态记忆索引快照（宿主每调用读 memory/MEMORY.md 派生；空时 memory.index 段省略） */
  readonly memoryIndex?: MemoryIndexSnapshot;
}

/**
 * 小说全局约束提供者：每 provider call 前调用（node 层 fs 读取两层 NOVEL.md）。
 * 读取失败返回 undefined → 动态段渲染占位。这是唯一的宿主注入缝——
 * LoopContext 自身已持有 workdir（workspace）与 modelId（run.sampling.model）。
 */
export type NovelConstraintsProvider = () => Promise<NovelGlobalConstraintsSnapshot | undefined>;

/**
 * 动态记忆索引提供者：每 provider call 前调用（node 层读 memory/MEMORY.md）。
 * 读取失败/目录缺失返回 undefined → memory.index 段省略（对齐 skill.index 空省略先例）。
 * Dynamic memory-index provider: invoked before each provider call (the node
 * layer reads memory/MEMORY.md). Failures or a missing directory return
 * undefined and the memory.index section is omitted.
 */
export type MemoryIndexProvider = () => Promise<MemoryIndexSnapshot | undefined>;

/**
 * 案例引导提供者：每 provider call 前调用（node 层扫描 .novel/cases 派生）。
 * 读取失败返回 undefined → 规范段仅省略「参考案例」小节（正文恒渲染）。
 * Case guide provider: invoked before each provider call (the node layer
 * derives the snapshot by scanning .novel/cases). Failures return undefined and
 * the standard sections omit their "reference cases" subsection only.
 */
export type CaseGuideProvider = () => Promise<CaseGuideSnapshot | undefined>;

/**
 * 静态分段：base 缓存一次渲染，跨 provider call 复用（内容恒定）。
 * kind 与渲染方法绑定：static 只实现 render，杜绝「声明 static 却按动态渲染」的错配。
 */
export interface StaticPromptSection {
  readonly kind: "static";
  /** 段 id（注册表 id@version 定位） */
  readonly id: string;
  /** 段版本（semver） */
  readonly version: string;
  /** 段标签（展示层） */
  readonly label: string;
  /**
   * 渲染分段内容（静态：只渲染一次进 base 缓存）
   * @param ctx LoopContext 只读视图
   * @returns 分段文本
   */
  render(ctx: ReadonlyLoopContext): string;
}

/**
 * 动态分段：每 provider call 重新渲染（依赖动态输入或实时 ctx）。
 * kind 与渲染方法绑定：dynamic 只实现 renderDynamic，杜绝「声明 dynamic 却实现 render」的错配。
 */
export interface DynamicPromptSection {
  readonly kind: "dynamic";
  /** 段 id（注册表 id@version 定位） */
  readonly id: string;
  /** 段版本（semver） */
  readonly version: string;
  /** 段标签（展示层） */
  readonly label: string;
  /**
   * 每 provider call 渲染分段内容；输入缺失或无需输出时返回空串（空串不进 prompt）
   * @param input 动态段输入（宿主注入；tool.guidance 等纯 ctx 段忽略）
   * @param ctx LoopContext 只读视图
   * @returns 分段文本（空串 = 本段省略）
   */
  renderDynamic(input: DynamicPromptSectionInput, ctx: ReadonlyLoopContext): string;
}

/** 系统提示词分段（判别联合：kind 与渲染方法绑定） */
export type PromptSection = StaticPromptSection | DynamicPromptSection;
