/** Concrete Subagent Tools with colocated schemas, descriptors, and handlers. */
import type { Logger } from "../../observability/index.js";
import { ToolRegistry } from "../../tooling/registry/index.js";
import {
  createTaskTool,
  type CreateTaskToolOptions,
} from "./Task.js";
import {
  createTaskCancelTool,
  type CreateTaskCancelToolOptions,
} from "./TaskCancel.js";
import {
  createTaskGetTool,
  type CreateTaskGetToolOptions,
} from "./TaskGet.js";

export * from "./Task.js";
export * from "./TaskCancel.js";
export * from "./TaskGet.js";

export type SubagentTaskToolRegistryOptions =
  Omit<CreateTaskToolOptions, "logger"> &
  Omit<CreateTaskGetToolOptions, "logger"> &
  Omit<CreateTaskCancelToolOptions, "logger"> & {
    readonly logger?: Logger;
  };

export function createSubagentTaskToolRegistry(
  options: SubagentTaskToolRegistryOptions,
): ToolRegistry {
  return new ToolRegistry([
    createTaskTool(options),
    createTaskGetTool(options),
    createTaskCancelTool(options),
  ]);
}
