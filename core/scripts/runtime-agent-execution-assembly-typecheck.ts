/** Compile-time examples for provider-neutral Agent execution assembly. */
import {
  AgentRuntimeExecutionAssembler,
  AgentRuntimeExecutionAssembly,
  type AgentRuntimeAdapterFactory,
  type AgentRuntimeContextCompilerFactory,
} from "../src/index.js";

const adapterFactory: AgentRuntimeAdapterFactory = undefined as never;
const contextCompilerFactory: AgentRuntimeContextCompilerFactory = undefined as never;
const assembler = new AgentRuntimeExecutionAssembler({
  adapterFactory,
  contextCompilerFactory,
});
const assembly: AgentRuntimeExecutionAssembly = undefined as never;

void assembler;
void assembly.systemPromptSource;
