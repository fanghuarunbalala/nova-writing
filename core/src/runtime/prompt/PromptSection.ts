import type { ReadonlyLoopContext } from "../loop/LoopContext.js";

/**
 * 动态段渲染输入：宿主每 provider call 注入一次（纯数据，prompt 层不接触 node:fs）。
 * Dynamic section render input: injected once per provider call by the host
 * (pure data; the prompt layer never touches node:fs).
 */
export interface DynamicPromptSectionInput {
  /** 环境快照：workdir/platform 由 node 层注入；modelId 由 LoopContext 以 run.sampling.model 补齐 */
  readonly environment?: {
    /** 工作目录 */
    readonly workdir: string;
    /** 平台标识 */
    readonly platform: string;
    /** 模型 id（缺省时 LoopContext 补齐为当前 run 的 sampling.model） */
    readonly modelId?: string;
  };
  /** 小说全局约束快照：node 层每调用读取 NOVEL.md 注入（≤256 KiB） */
  readonly novelGlobalConstraints?: {
    /** 文件名（如 NOVEL.md），用于块标题 */
    readonly fileName: string;
    /** 文件内容（UTF-8，≤256 KiB） */
    readonly content: string;
  };
}

/**
 * 动态段输入提供者：LoopContext 构造注入，每 provider call 前调用。
 * 缺省为空输入（不注入任何动态内容）。
 */
export type DynamicInputProvider = () => Promise<DynamicPromptSectionInput>;

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
