/** Provider-neutral execution dependencies assembled for one Agent Runtime configuration. */
import type { ContextCompiler } from "../context/index.js";
import type { AgentRuntimeAdapter } from "./AgentRuntimeAdapter.js";
import type { AgentRuntimeConfiguration } from "./AgentRuntimeConfiguration.js";
import { AgentRuntimeSystemPromptSource } from "./AgentRuntimeSystemPromptSource.js";
import type { RuntimeSystemPromptSource } from "../execution/agent/RuntimeSystemPromptSource.js";
import {
  ComposeAwareRuntimeSystemPromptSource,
  ComposeModeStateProvider,
} from "../compose/index.js";

export interface AgentRuntimeAdapterFactory {
  create(configuration: AgentRuntimeConfiguration): Promise<AgentRuntimeAdapter>;
}

export interface AgentRuntimeContextCompilerFactory {
  create(configuration: AgentRuntimeConfiguration): Promise<ContextCompiler>;
}

export interface AgentRuntimeExecutionAssemblyOptions {
  readonly configuration: AgentRuntimeConfiguration;
  readonly contextCompiler: ContextCompiler;
  readonly agentAdapter: AgentRuntimeAdapter;
  /** compose 状态源；提供时 system prompt 附加 compose 提示段。 */
  /** Compose state source; when provided the system prompt gains the compose overlay. */
  readonly composeState?: ComposeModeStateProvider;
}

export class AgentRuntimeExecutionAssembly {
  readonly configuration: AgentRuntimeConfiguration;
  readonly systemPromptSource: RuntimeSystemPromptSource;
  readonly contextCompiler: ContextCompiler;
  readonly agentAdapter: AgentRuntimeAdapter;

  constructor(options: AgentRuntimeExecutionAssemblyOptions) {
    this.configuration = options.configuration;
    const baseSource = new AgentRuntimeSystemPromptSource(options.configuration);
    this.systemPromptSource =
      options.composeState === undefined
        ? baseSource
        : new ComposeAwareRuntimeSystemPromptSource(
            baseSource,
            options.composeState,
          );
    this.contextCompiler = options.contextCompiler;
    this.agentAdapter = options.agentAdapter;
    Object.freeze(this);
  }
}
