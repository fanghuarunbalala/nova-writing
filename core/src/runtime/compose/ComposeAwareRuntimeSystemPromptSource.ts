/**
 * Compose 感知的 SystemPrompt 源：compose 激活时把提示段 overlay 附加到基础提示。
 * Compose-aware system prompt source: appends the compose overlay while active.
 */
import type { RuntimeRunExecutionRequest } from "../execution/control/RuntimeUserMessageInputHandler.js";
import type { RuntimeSystemPromptSource } from "../execution/agent/RuntimeSystemPromptSource.js";
import { ComposeModeStateProvider } from "./ComposeModeState.js";
import { ComposePromptContributor } from "./ComposePromptContributor.js";

export class ComposeAwareRuntimeSystemPromptSource
  implements RuntimeSystemPromptSource
{
  readonly #base: RuntimeSystemPromptSource;
  readonly #contributor: ComposePromptContributor;

  constructor(
    base: RuntimeSystemPromptSource,
    state: ComposeModeStateProvider,
  ) {
    this.#base = base;
    this.#contributor = new ComposePromptContributor(state);
  }

  async resolve(request: RuntimeRunExecutionRequest): Promise<string> {
    const basePrompt = await this.#base.resolve(request);
    return this.#contributor.append(request.conversationId, basePrompt);
  }
}
