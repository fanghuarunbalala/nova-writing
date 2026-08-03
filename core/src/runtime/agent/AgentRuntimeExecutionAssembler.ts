/** Creates provider-neutral execution dependencies while hiding Provider adapters. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { AgentRuntimeConfiguration } from "./AgentRuntimeConfiguration.js";
import {
  AgentRuntimeExecutionAssembly,
  type AgentRuntimeAdapterFactory,
  type AgentRuntimeContextCompilerFactory,
} from "./AgentRuntimeExecutionAssembly.js";

export interface AgentRuntimeExecutionAssemblerOptions {
  readonly adapterFactory: AgentRuntimeAdapterFactory;
  readonly contextCompilerFactory: AgentRuntimeContextCompilerFactory;
  readonly logger?: Logger;
}

export class AgentRuntimeExecutionAssembler {
  readonly #adapterFactory: AgentRuntimeAdapterFactory;
  readonly #contextCompilerFactory: AgentRuntimeContextCompilerFactory;
  readonly #logger: Logger;

  constructor(options: AgentRuntimeExecutionAssemblerOptions) {
    this.#adapterFactory = options.adapterFactory;
    this.#contextCompilerFactory = options.contextCompilerFactory;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "agent_runtime_execution_assembler",
    });
  }

  async assemble(
    configuration: AgentRuntimeConfiguration,
  ): Promise<AgentRuntimeExecutionAssembly> {
    this.#logger.debug("agent_runtime.execution_assembly_started", {
      conversationId: configuration.conversationId,
      agentType: configuration.assembly.agentType,
      definitionVersion: configuration.assembly.definitionVersion,
    });
    const [contextCompiler, agentAdapter] = await Promise.all([
      this.#contextCompilerFactory.create(configuration),
      this.#adapterFactory.create(configuration),
    ]);
    const assembly = new AgentRuntimeExecutionAssembly({
      configuration,
      contextCompiler,
      agentAdapter,
    });
    this.#logger.info("agent_runtime.execution_assembly_completed", {
      conversationId: configuration.conversationId,
      agentType: configuration.assembly.agentType,
      definitionVersion: configuration.assembly.definitionVersion,
    });
    return assembly;
  }
}
