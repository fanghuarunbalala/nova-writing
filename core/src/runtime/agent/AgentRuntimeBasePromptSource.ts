/**
 * 从 Agent Runtime 配置返回编译后的 base prompt（CompiledSystemPrompt）。
 * Returns the compiled base prompt (CompiledSystemPrompt) from an Agent Runtime
 * configuration, for the provider-call assembly seam.
 */
import type { PromptBase } from "../../prompt/index.js";
import type { RuntimeRunExecutionRequest } from "../execution/control/RuntimeUserMessageInputHandler.js";
import type { RuntimeBasePromptSource } from "../execution/agent/RuntimeSystemPromptSource.js";
import type { AgentRuntimeConfiguration } from "./AgentRuntimeConfiguration.js";

/** base prompt 源：每次 Run 解析同一份 Manifest 编译 prompt。Base-prompt source resolving the manifest-compiled prompt per run. */
export class AgentRuntimeBasePromptSource implements RuntimeBasePromptSource {
  constructor(readonly configuration: AgentRuntimeConfiguration) {}

  /** 校验会话并返回编译后的 base prompt。Validates the conversation and returns the compiled base prompt. */
  async resolve(request: RuntimeRunExecutionRequest): Promise<PromptBase> {
    if (request.conversationId !== this.configuration.conversationId) {
      throw new TypeError("Runtime Base Prompt targets another Conversation");
    }
    return this.configuration.assembly.systemPrompt;
  }
}
