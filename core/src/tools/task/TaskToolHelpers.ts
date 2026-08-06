/** Shared list resolution, JSON mapping, and failure helpers for Work-Item Task Tools. */
import type { JsonObject } from "../../event/protocol/index.js";
import { defaultTaskListResolver } from "../../runtime/task/TaskListResolver.js";
import type {
  TaskListResolver,
  WorkItemSnapshot,
} from "../../runtime/task/TaskProtocol.js";
import {
  ToolError,
  type ToolSideEffectStatus,
} from "../../runtime/tools/execution/index.js";
import type { ToolExecutionContext } from "../../tooling/protocol/index.js";

export async function resolveTaskList(
  context: ToolExecutionContext,
  resolver: TaskListResolver,
): Promise<string> {
  return resolver.resolve({ conversationId: context.conversationId });
}

export function defaultTaskResolver(): TaskListResolver {
  return defaultTaskListResolver;
}

export function taskToolFailure(
  context: ToolExecutionContext,
  code: string,
  retryable: boolean,
  toolName: string,
  toolVersion: string,
  sideEffectStatus: ToolSideEffectStatus = "none",
): ToolError {
  return new ToolError({
    code,
    category: "execution",
    retryable,
    sideEffectStatus,
    conversationId: context.conversationId,
    runId: context.runId,
    toolCallId: context.toolCallId,
    toolName,
    toolVersion,
  });
}

export function workItemToJson(item: WorkItemSnapshot): JsonObject {
  return Object.freeze({
    id: item.id,
    subject: item.subject,
    description: item.description,
    status: item.status,
    ...(item.activeForm === undefined ? {} : { activeForm: item.activeForm }),
    ...(item.owner === undefined ? {} : { owner: item.owner }),
    blocks: [...item.blocks],
    blockedBy: [...item.blockedBy],
    metadata: item.metadata as unknown as JsonObject,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}
