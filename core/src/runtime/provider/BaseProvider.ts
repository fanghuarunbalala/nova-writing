import type {
  ProviderConfig,
  ProviderCall,
  ProviderResult,
  ProviderDelta,
  ProviderOnDelta,
  SamplingConfig,
  ThinkingLevel,
  EffortLevel,
} from "./types.js";
import type { Provider } from "./Provider.js";
import {
  ProviderAbortedError,
  toProviderError,
  type ProviderError,
} from "./errors.js";
import {
  ModelInfoRegistry,
  type ModelInfo,
  type ThinkingParam,
  type ProviderSamplingParams,
} from "./model-info.js";

/** 抽象基类：模板方法，默认实现 call 骨架与采样转换 */
export abstract class BaseProvider implements Provider {
  /** Provider 实例配置 */
  protected readonly config: ProviderConfig;
  /** 模型信息注册表（采样参数映射依据） */
  protected readonly modelInfo: ModelInfoRegistry;

  /**
   * 构造 BaseProvider
   * @param config Provider 实例配置
   * @param modelInfo 可选：模型信息注册表，缺省新建默认实例
   */
  constructor(config: ProviderConfig, modelInfo?: ModelInfoRegistry) {
    this.config = config;
    this.modelInfo = modelInfo ?? new ModelInfoRegistry();
  }

  /**
   * 模板方法：一次请求的完整骨架，子类不重写
   * @param call 单次请求参数
   * @param onDelta 可选：流式中间增量回调
   * @returns 最终完整结果 ProviderResult
   * @throws ProviderError 标准化异常
   */
  async call(call: ProviderCall, onDelta?: ProviderOnDelta): Promise<ProviderResult> {
    try {
      // ① 取消检查
      this.assertNotAborted(call.signal);
      // ② 发起上游流（子类钩子）
      for await (const chunk of this.createStream(call)) {
        this.assertNotAborted(call.signal);
        // ③ chunk → 中立 delta（子类钩子），回调
        const delta = this.normalizeDelta(chunk);
        if (delta && onDelta) onDelta(delta);
      }
      // ④ 构建最终结果（子类钩子）
      return this.buildResult(call);
    } catch (raw) {
      // ⑤ 边界统一封装（私有默认）
      throw this.wrapError(raw);
    }
  }

  /** 上游请求流（子类实现：接 SDK，返回原始 chunk 迭代） */
  protected abstract createStream(call: ProviderCall): AsyncIterable<unknown>;
  /** 原始 chunk → 中立 delta（子类实现；无增量可返回 null） */
  protected abstract normalizeDelta(chunk: unknown): ProviderDelta | null;
  /** 累积状态 → 最终 ProviderResult（子类实现） */
  protected abstract buildResult(call: ProviderCall): ProviderResult;

  /**
   * 模板方法：SamplingConfig + ModelInfo → 厂商采样参数（子类组装 SDK 请求用）
   * @param sampling 中立采样配置
   * @returns 中立偏厂商的采样参数
   */
  protected buildSamplingParams(sampling: SamplingConfig): ProviderSamplingParams {
    const info = this.modelInfo.getModelInfo(sampling.model);
    return {
      model: sampling.model,
      maxTokens: sampling.maxTokens,
      temperature: info.supportsTemperature ? sampling.temperature : undefined,
      thinking: this.buildThinkingParam(sampling.thinking, info),
    };
  }

  /**
   * 思考映射：档位 + model info → 厂商 thinking 参数（**默认实现**，子类可按厂商 SDK 形态覆盖）
   * @param thinking 思考档位（缺省跟随模型默认）
   * @param info 模型能力信息
   * @returns 厂商思考参数；不支持思考的模型返回 undefined
   */
  protected buildThinkingParam(
    thinking: ThinkingLevel | undefined,
    info: ModelInfo,
  ): ThinkingParam | undefined {
    if (thinking === undefined) return undefined;
    if (thinking === "off") return { type: "disabled" };
    switch (info.thinkingMode) {
      case "adaptive-effort":
        return { type: "adaptive", effort: this.clampEffort(thinking, info.effortLevels) };
      case "reasoning-effort":
        return { type: "reasoning", effort: this.clampEffort(thinking, info.effortLevels) };
      case "budget-tokens":
        return { type: "enabled", budgetTokens: this.tokensFromLevel(thinking, info.maxOutputTokens) };
      case "none":
        return undefined;
    }
  }

  /**
   * 档位收敛：把上层档位映射到厂商支持集（向上取不小于目标的最小档）
   * 如 deepseek 支持 [low, high, max] 时，medium→high、xhigh→high
   * @param level 上层思考档位
   * @param supported 厂商支持的档位集；缺省/为空时不收敛
   * @returns 收敛后的档位
   */
  private clampEffort(level: EffortLevel, supported?: readonly EffortLevel[]): EffortLevel {
    if (!supported || supported.length === 0 || supported.includes(level)) return level;
    const order: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
    const idx = order.indexOf(level);
    for (let i = idx; i < order.length; i++) {
      const candidate = order[i];
      if (candidate !== undefined && supported.includes(candidate)) return candidate;
    }
    return supported[supported.length - 1] ?? level;
  }

  /** 档位 → token 数（budget-tokens 模式，按最大输出 token 的比例估算） */
  private tokensFromLevel(level: EffortLevel, maxOutputTokens?: number): number {
    const ratio: Record<EffortLevel, number> = {
      low: 0.25,
      medium: 0.5,
      high: 0.75,
      xhigh: 0.9,
      max: 1,
    };
    return Math.floor((maxOutputTokens ?? 8192) * ratio[level]);
  }

  /** 取消检查（私有默认） */
  private assertNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new ProviderAbortedError("请求已被取消");
    }
  }
  /** 错误封装（私有默认） */
  private wrapError(raw: unknown): ProviderError {
    return toProviderError(raw, this.providerName);
  }
  /** 子类标识名（错误来源标注，子类覆盖） */
  protected get providerName(): string {
    return "unknown";
  }
}
