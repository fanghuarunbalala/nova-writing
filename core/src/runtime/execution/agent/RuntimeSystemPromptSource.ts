/**
 * 解析最终 base System Prompt，不暴露分层策略。
 * Resolves the final base System Prompt without exposing its layer strategy.
 */
import type { RuntimeRunExecutionRequest } from "../control/RuntimeUserMessageInputHandler.js";
import type { PromptBase } from "../../../prompt/index.js";

export interface RuntimeSystemPromptSource {
  resolve(request: RuntimeRunExecutionRequest): Promise<string>;
}

/** 解析编译后的 base prompt 值对象（provider 组装输入）。Resolves the compiled base prompt value object (provider-assembly input). */
export interface RuntimeBasePromptSource {
  resolve(request: RuntimeRunExecutionRequest): Promise<PromptBase>;
}
