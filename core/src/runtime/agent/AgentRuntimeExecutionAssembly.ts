/** Provider-neutral execution dependencies assembled for one Agent Runtime configuration. */
import type { ContextCompiler } from "../context/index.js";
import type { AgentRuntimeAdapter } from "./AgentRuntimeAdapter.js";
import type { AgentRuntimeConfiguration } from "./AgentRuntimeConfiguration.js";
import { AgentRuntimeSystemPromptSource } from "./AgentRuntimeSystemPromptSource.js";

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
}

export class AgentRuntimeExecutionAssembly {
  readonly configuration: AgentRuntimeConfiguration;
  readonly systemPromptSource: AgentRuntimeSystemPromptSource;
  readonly contextCompiler: ContextCompiler;
  readonly agentAdapter: AgentRuntimeAdapter;

  constructor(options: AgentRuntimeExecutionAssemblyOptions) {
    this.configuration = options.configuration;
    this.systemPromptSource = new AgentRuntimeSystemPromptSource(
      options.configuration,
    );
    this.contextCompiler = options.contextCompiler;
    this.agentAdapter = options.agentAdapter;
    Object.freeze(this);
  }
}
