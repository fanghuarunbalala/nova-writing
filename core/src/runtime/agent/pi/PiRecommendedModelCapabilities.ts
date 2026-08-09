/**
 * 已知模型的官方规格与推荐派生规则：由 modelId 查找推荐能力，供 createPiExecutionModel
 * 填充 contextWindow / maxTokens。profile 显式覆盖 > 推荐派生 > source 默认。
 * Known-model recommended capabilities and derived rules consumed by
 * createPiExecutionModel; explicit profile overrides win, then recommended
 * derivation, then the source-model defaults.
 */

/** 每次输出的最小 token（统一下限）。Per-call output floor. */
export const MINIMUM_RECOMMENDED_OUTPUT_TOKENS = 12_000;

/** 推荐输出 = 官方最大输出 × 该比率。Recommended output = official max output × ratio. */
export const RECOMMENDED_OUTPUT_RATIO = 0.6;

/** 压缩窗口 = 官方上下文窗口 × 该比率（pi 运行时按 model.contextWindow 触发压缩）。 */
export const COMPACTION_WINDOW_RATIO = 0.7;

/** 已知模型的官方规格（厂家宣称值）。Official specs for known models. */
export interface RecommendedModelCapabilities {
  readonly contextWindowTokens: number;
  readonly maximumOutputTokens: number;
}

export const RECOMMENDED_MODEL_CAPABILITIES: ReadonlyMap<
  string,
  RecommendedModelCapabilities
> = new Map([
  // deepseek-v4-flash：上下文 1M、最大输出 384K。
  ["deepseek-v4-flash", {
    contextWindowTokens: 1_000_000,
    maximumOutputTokens: 384_000,
  }],
]);
