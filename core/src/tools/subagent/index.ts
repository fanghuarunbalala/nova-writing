/** Concrete Subagent Tools with colocated schemas, descriptors, and handlers. */
import type { Logger } from "../../observability/index.js";
import type { ToolGroupManifest } from "../../tooling/group/index.js";
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

/** 子代理执行工具组：Agent/TaskOutput/TaskStop。Subagent execution tool group. */
export const SUBAGENT_TOOL_GROUP_MANIFEST: ToolGroupManifest =
  Object.freeze({
    schemaVersion: 1,
    id: "runtime.subagent",
    version: "1.0.0",
    label: "Runtime Subagent Tools",
    description:
      "Spawn asynchronous Subagent Tasks and observe their status, output, and cancellation.",
    tools: Object.freeze(["Agent", "TaskOutput", "TaskStop"]),
  });

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
