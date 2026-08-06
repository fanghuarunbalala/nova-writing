/** Concrete Work-Item Task Tools. */
import {
  type TaskListResolver,
  type WorkItemListQuerier,
  type WorkItemWriter,
} from "../../runtime/task/TaskProtocol.js";
import { defaultTaskListResolver } from "../../runtime/task/TaskListResolver.js";
import { ToolRegistry } from "../../tooling/registry/index.js";
import {
  createWorkItemTaskCreateTool,
  type CreateWorkItemTaskCreateToolOptions,
} from "./TaskCreate.js";
import {
  createWorkItemTaskGetTool,
  type CreateWorkItemTaskGetToolOptions,
} from "./TaskGet.js";
import {
  createWorkItemTaskListTool,
  type CreateWorkItemTaskListToolOptions,
} from "./TaskList.js";
import {
  createWorkItemTaskUpdateTool,
  type CreateWorkItemTaskUpdateToolOptions,
} from "./TaskUpdate.js";

export * from "./TaskCreate.js";
export * from "./TaskGet.js";
export * from "./TaskList.js";
export * from "./TaskUpdate.js";

export interface CreateTaskToolRegistryOptions {
  readonly writer: WorkItemWriter;
  readonly querier: WorkItemListQuerier;
  readonly resolver?: TaskListResolver;
}

export function createTaskToolRegistry(
  options: CreateTaskToolRegistryOptions,
): ToolRegistry {
  const resolver = options.resolver ?? defaultTaskListResolver;
  return new ToolRegistry([
    createWorkItemTaskCreateTool({
      writer: options.writer,
      resolver,
    } satisfies CreateWorkItemTaskCreateToolOptions),
    createWorkItemTaskListTool({
      querier: options.querier,
      resolver,
    } satisfies CreateWorkItemTaskListToolOptions),
    createWorkItemTaskGetTool({
      querier: options.querier,
      resolver,
    } satisfies CreateWorkItemTaskGetToolOptions),
    createWorkItemTaskUpdateTool({
      writer: options.writer,
      resolver,
    } satisfies CreateWorkItemTaskUpdateToolOptions),
  ]);
}
