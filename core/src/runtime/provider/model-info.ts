import type { EffortLevel } from "./types.js";

/** 模型支持的思考能力模式：决定 thinking 档位如何映射 */
export type ThinkingMode =
  /** Anthropic 新一代：adaptive thinking + effort 档 */
  | "adaptive-effort"
  /** 旧模型：enabled + budget_tokens */
  | "budget-tokens"
  /** OpenAI 推理模型：reasoning_effort */
  | "reasoning-effort"
  /** 本地/未知模型：不支持思考 */
  | "none";

/** 模型能力信息（中立，驱动 SamplingConfig → 厂商参数映射） */
export interface ModelInfo {
  /** 模型名 */
  model: string;
  /** 是否支持采样温度（Anthropic 新模型已移除） */
  supportsTemperature: boolean;
  /** 思考能力模式 */
  thinkingMode: ThinkingMode;
  /** 该模型支持的 effort 档位（adaptive-effort / reasoning-effort 用） */
  effortLevels?: readonly EffortLevel[];
  /** 最大输出 token（budget-tokens 映射档位用） */
  maxOutputTokens?: number;
}

/** 厂商思考参数（适配层映射产物，供子类组装 SDK 请求） */
export type ThinkingParam =
  | { type: "disabled" }
  | { type: "adaptive"; effort: EffortLevel }
  | { type: "reasoning"; effort: EffortLevel }
  | { type: "enabled"; budgetTokens: number };

/** 采样转换结果：中立偏厂商中间结构，子类适配器据此组装 SDK 原生请求 */
export interface ProviderSamplingParams {
  /** 模型名 */
  model: string;
  /** 最大输出 token */
  maxTokens?: number;
  /** 采样温度（模型不支持时 undefined） */
  temperature?: number;
  /** 思考参数（关闭 / adaptive / reasoning / budget） */
  thinking?: ThinkingParam;
}

/** 模型信息注册表：默认按模型名启发式推断，可注册覆盖 */
export class ModelInfoRegistry {
  /** 已注册的模型 info 覆盖 */
  private readonly overrides = new Map<string, ModelInfo>();

  /**
   * 注册/覆盖指定模型的 info（预留的扩展接口，覆盖默认推断）
   * @param model 模型名
   * @param info 模型能力信息
   */
  register(model: string, info: ModelInfo): void {
    this.overrides.set(model, info);
  }

  /**
   * 获取模型 info：overrides 优先，缺省按模型名启发式推断
   * @param model 模型名
   * @returns 模型能力信息
   */
  getModelInfo(model: string): ModelInfo {
    return this.overrides.get(model) ?? this.defaultInfo(model);
  }

  /**
   * 默认推断：按模型名前缀启发式生成
   * @param model 模型名
   * @returns 默认模型能力信息
   */
  private defaultInfo(model: string): ModelInfo {
    const m = model.toLowerCase();
    if (m.includes("claude")) {
      // 新一代：adaptive thinking + effort，已移除采样温度
      if (/(opus-4-(7|8)|opus-5|sonnet-5|fable-5|mythos-5)/.test(m)) {
        return { model, supportsTemperature: false, thinkingMode: "adaptive-effort" };
      }
      // 4.6 及更早：adaptive-effort + 支持温度
      return { model, supportsTemperature: true, thinkingMode: "adaptive-effort" };
    }
    if (m.includes("deepseek")) {
      // DeepSeek（OpenAI 兼容）：thinking 默认开启，reasoning_effort 仅 low/high/max（xhigh 落到 high）
      return {
        model,
        supportsTemperature: true,
        thinkingMode: "reasoning-effort",
        effortLevels: ["low", "high", "max"],
      };
    }
    if (
      m.startsWith("o1") ||
      m.startsWith("o3") ||
      m.startsWith("o4") ||
      m.includes("gpt-5") ||
      m.includes("gpt-o")
    ) {
      return { model, supportsTemperature: true, thinkingMode: "reasoning-effort" };
    }
    // 本地 / 未知模型：保守默认
    return { model, supportsTemperature: true, thinkingMode: "none" };
  }
}
