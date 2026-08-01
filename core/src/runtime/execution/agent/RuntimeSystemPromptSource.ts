/** Resolves the final base System Prompt without exposing its layer strategy. */
import type { RuntimeRunExecutionRequest } from "../control/RuntimeUserMessageInputHandler.js";

export interface RuntimeSystemPromptSource {
  resolve(request: RuntimeRunExecutionRequest): Promise<string>;
}
