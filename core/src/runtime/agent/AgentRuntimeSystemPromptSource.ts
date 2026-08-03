/** Resolves the immutable Manifest Base Prompt for one bound Conversation Runtime. */
import type { RuntimeRunExecutionRequest } from "../execution/control/RuntimeUserMessageInputHandler.js";
import type { RuntimeSystemPromptSource } from "../execution/agent/RuntimeSystemPromptSource.js";
import type { AgentRuntimeConfiguration } from "./AgentRuntimeConfiguration.js";

export class AgentRuntimeSystemPromptSource implements RuntimeSystemPromptSource {
  constructor(readonly configuration: AgentRuntimeConfiguration) {}

  async resolve(request: RuntimeRunExecutionRequest): Promise<string> {
    if (request.conversationId !== this.configuration.conversationId) {
      throw new TypeError("Runtime System Prompt targets another Conversation");
    }
    return this.configuration.assembly.systemPrompt.content;
  }
}
