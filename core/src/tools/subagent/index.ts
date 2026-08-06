/** Concrete Subagent Tools with colocated schemas, descriptors, and handlers. */
import type { Logger } from "../../observability/index.js";
import { ToolRegistry } from "../../tooling/registry/index.js";
import {
  createAgentTool,
  type CreateAgentToolOptions,
} from "./Agent.js";
import {
  createTaskStopTool,
  type CreateTaskStopToolOptions,
} from "./TaskStop.js";
import {
  createTaskOutputTool,
  type CreateTaskOutputToolOptions,
} from "./TaskOutput.js";

export * from "./Agent.js";
export * from "./TaskStop.js";
export * from "./TaskOutput.js";

export type AgentExecutionToolRegistryOptions =
  Omit<CreateAgentToolOptions, "logger"> &
  Omit<CreateTaskOutputToolOptions, "logger"> &
  Omit<CreateTaskStopToolOptions, "logger"> & {
    readonly logger?: Logger;
  };

export function createAgentExecutionToolRegistry(
  options: AgentExecutionToolRegistryOptions,
): ToolRegistry {
  return new ToolRegistry([
    createAgentTool(options),
    createTaskOutputTool(options),
    createTaskStopTool(options),
  ]);
}

export type SubagentTaskToolRegistryOptions = AgentExecutionToolRegistryOptions;

export const createSubagentTaskToolRegistry = createAgentExecutionToolRegistry;
