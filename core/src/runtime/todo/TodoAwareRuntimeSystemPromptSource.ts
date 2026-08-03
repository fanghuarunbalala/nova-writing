/** Composes the base System Prompt with the current Conversation Todo overlay. */
import type { RuntimeRunExecutionRequest } from "../execution/control/RuntimeUserMessageInputHandler.js";
import type { RuntimeSystemPromptSource } from "../execution/agent/RuntimeSystemPromptSource.js";
import { TodoPromptContributor } from "./TodoPromptContributor.js";
import type { ConversationTodoReader } from "./TodoProtocol.js";

export class TodoAwareRuntimeSystemPromptSource
  implements RuntimeSystemPromptSource
{
  readonly #base: RuntimeSystemPromptSource;
  readonly #todos: TodoPromptContributor;

  constructor(base: RuntimeSystemPromptSource, reader: ConversationTodoReader) {
    this.#base = base;
    this.#todos = new TodoPromptContributor(reader);
  }

  async resolve(request: RuntimeRunExecutionRequest): Promise<string> {
    const basePrompt = await this.#base.resolve(request);
    return this.#todos.append(request.conversationId, basePrompt);
  }
}
