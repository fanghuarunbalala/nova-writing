import type { ReadonlyLoopContext } from "../loop/LoopContext.js";

/**
 * 小说全局约束快照：node 层每调用读取 NOVEL.md 注入（≤256 KiB）。
 * Novel global-constraints snapshot: injected by the node layer after reading
 * NOVEL.md per call (≤256 KiB).
 */
export interface NovelGlobalConstraintsSnapshot {
  /** 文件名（如 NOVEL.md），用于块标题 */
  readonly fileName: string;
  /** 文件内容（UTF-8，≤256 KiB） */
  readonly content: string;
}

/**
 * compose 案例引导快照：node 层扫描 workspace `.novel/cases` 派生（PRD
 * compose-案例引导）。索引文本与正文消息通道分离——本快照只承载索引，
 * 选中正文以 `<novel-guide>` 消息注入（不走动态段）。
 * Compose guide snapshot: derived by the node layer from scanning the
 * workspace `.novel/cases` directory. Index and selected-case content travel
 * on separate channels — this snapshot carries the index only; selected case
 * bodies are injected as a `<novel-guide>` message instead.
 */
export interface ComposeGuideSnapshot {
  /** 索引文本（每案一行，已按 order/文件名序） */
  readonly index: string;
  /** 案例目录（workspace 相对路径，恒 ".novel/cases"） */
  readonly casesDir: string;
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
  /** compose 案例引导快照（宿主每调用注入；缺失时 novel.compose.guide 段渲染占位） */
  readonly composeGuide?: ComposeGuideSnapshot;
}

/**
 * 小说全局约束提供者：每 provider call 前调用（node 层 fs 读取 NOVEL.md）。
 * 读取失败返回 undefined → 动态段渲染占位。这是唯一的宿主注入缝——
 * LoopContext 自身已持有 workdir（workspace）与 modelId（run.sampling.model）。
 */
export type NovelConstraintsProvider = () => Promise<NovelGlobalConstraintsSnapshot | undefined>;

/**
 * compose 案例引导提供者：每 provider call 前调用（node 层扫描 .novel/cases 派生）。
 * 读取失败返回 undefined → novel.compose.guide 动态段渲染占位。
 * Compose guide provider: invoked before each provider call (the node layer
 * derives the snapshot by scanning .novel/cases). Failures return undefined and
 * the dynamic section renders its placeholder.
 */
export type ComposeGuideProvider = () => Promise<ComposeGuideSnapshot | undefined>;

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
