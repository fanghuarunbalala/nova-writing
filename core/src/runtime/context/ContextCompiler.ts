/** Core-owned context contracts kept independent from Provider message types. */
import type { RuntimeMessageSnapshot } from "../message/index.js";

export interface ContextCompileRequest {
  readonly conversationId: string;
  readonly runId: string;
  /** Final base prompt selected by the caller; layer ordering remains external. */
  readonly systemPrompt: string;
  /** Ordered canonical transcript before an optional prompt invocation. */
  readonly messages: readonly RuntimeMessageSnapshot[];
}

export interface CompiledProviderContext {
  readonly conversationId: string;
  readonly runId: string;
  readonly systemPrompt: string;
  readonly messages: readonly RuntimeMessageSnapshot[];
}

export interface ContextCompiler {
  compile(request: ContextCompileRequest): Promise<CompiledProviderContext>;
}
