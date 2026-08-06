/** Defines the TaskOutput schema, descriptor, and process-free Subagent run query with optional any-first wait. */
import { Type } from "typebox";
import type { JsonObject, JsonValue } from "../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  SUBAGENT_TASK_OUTPUT_LIMITS,
  SUBAGENT_TASK_STATUS,
  type SubagentTaskSnapshot,
} from "../../runtime/subagent/SubagentTaskProtocol.js";
import { captureSubagentTaskOutputArguments } from "../../runtime/subagent/SubagentTaskProtocolValidator.js";
import type { SubagentTaskQueryService } from "../../runtime/subagent/SubagentTaskQueryService.js";
import { ToolError } from "../../runtime/tools/execution/index.js";
import {
  defineTool,
  type RegisteredTool,
  type ToolExecutionContext,
  type ToolResult,
} from "../../tooling/protocol/index.js";

export const SubagentTaskOutputParametersSchema = Type.Object(
  {
    runIds: Type.Array(
      Type.String({ minLength: 1, maxLength: 256 }),
      {
        minItems: 1,
        maxItems: SUBAGENT_TASK_OUTPUT_LIMITS.maximumRunIds,
      },
    ),
    block: Type.Optional(Type.Boolean()),
    timeout: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: SUBAGENT_TASK_OUTPUT_LIMITS.maximumTimeoutMs,
      }),
    ),
  },
  { additionalProperties: false },
);

export interface CreateTaskOutputToolOptions {
  readonly query: SubagentTaskQueryService;
  readonly timeSource?: { now(): number };
  readonly pollIntervalMs?: number;
  readonly logger?: Logger;
}

const TERMINAL_STATUSES = new Set<string>([
  SUBAGENT_TASK_STATUS.completed,
  SUBAGENT_TASK_STATUS.failed,
  SUBAGENT_TASK_STATUS.cancelled,
  SUBAGENT_TASK_STATUS.orphaned,
]);

export function createTaskOutputTool(
  options: CreateTaskOutputToolOptions,
): RegisteredTool {
  const logger = (options.logger ?? noopLogger).child({
    component: "subagent_task_output_tool",
  });
  const timeSource = options.timeSource ?? SYSTEM_TIME_SOURCE;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  return defineTool({
    descriptor: {
      name: "TaskOutput",
      version: "1.0.0",
      label: "Task Output",
      description:
        "Reads asynchronous Subagent run status and results. With block:true, returns as soon as any requested run reaches a terminal state or the timeout elapses. Never activates a child Runtime.",
      parameters: SubagentTaskOutputParametersSchema,
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        const captured = captureSubagentTaskOutputArguments(arguments_);
        if (!captured.block) {
          const runs = await queryAll(context, options.query, captured.runIds);
          logger.debug("runtime.subagent.task_output_tool.snapshot", {
            parentConversationId: context.conversationId,
            parentRunId: context.runId,
            runCount: runs.length,
          });
          return snapshotResult(runs);
        }
        const deadline = timeSource.now() + captured.timeout;
        while (true) {
          context.signal.throwIfAborted();
          const runs = await queryAll(context, options.query, captured.runIds);
          const terminalIndex = runs.findIndex((run) =>
            TERMINAL_STATUSES.has(run.status),
          );
          if (terminalIndex !== -1) {
            logger.debug("runtime.subagent.task_output_tool.completed", {
              parentConversationId: context.conversationId,
              parentRunId: context.runId,
              taskId: runs[terminalIndex].taskId,
              status: runs[terminalIndex].status,
            });
            return successResult(runs, terminalIndex);
          }
          if (timeSource.now() >= deadline) {
            logger.debug("runtime.subagent.task_output_tool.timeout", {
              parentConversationId: context.conversationId,
              parentRunId: context.runId,
              runCount: runs.length,
            });
            return timeoutResult(runs);
          }
          await sleep(pollIntervalMs);
        }
      },
    },
  });
}

const SYSTEM_TIME_SOURCE = Object.freeze({
  now: () => Date.now(),
});

async function queryAll(
  context: ToolExecutionContext,
  query: SubagentTaskQueryService,
  runIds: readonly string[],
): Promise<readonly SubagentTaskSnapshot[]> {
  try {
    const snapshots = await Promise.all(
      runIds.map((taskId) =>
        query.get({
          parentConversationId: context.conversationId,
          parentRunId: context.runId,
          taskId,
        }),
      ),
    );
    const resolved: SubagentTaskSnapshot[] = [];
    for (const snapshot of snapshots) {
      if (snapshot === undefined) {
        throw taskOutputFailure(
          context,
          "SUBAGENT_TASK_NOT_FOUND",
          false,
        );
      }
      resolved.push(snapshot);
    }
    return Object.freeze(resolved);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw taskOutputFailure(context, "SUBAGENT_TASK_QUERY_FAILED", true);
  }
}

function snapshotResult(
  runs: readonly SubagentTaskSnapshot[],
): ToolResult {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({
        type: "text" as const,
        text: `${runs.length} run(s).`,
      }),
    ]),
    details: Object.freeze({
      retrieval: "snapshot",
      runs: runs.map(runToJson),
    }),
  });
}

function successResult(
  runs: readonly SubagentTaskSnapshot[],
  terminalIndex: number,
): ToolResult {
  const run = runs[terminalIndex];
  const otherRuns = runs.filter((_, index) => index !== terminalIndex);
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({
        type: "text" as const,
        text: `Run ${run.taskId} reached ${run.status}.`,
      }),
    ]),
    details: Object.freeze({
      retrieval: "success",
      run: runToJson(run),
      otherRuns: otherRuns.map(runToJson),
    }),
  });
}

function timeoutResult(
  runs: readonly SubagentTaskSnapshot[],
): ToolResult {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({
        type: "text" as const,
        text: "No requested run reached a terminal state before the timeout.",
      }),
    ]),
    details: Object.freeze({
      retrieval: "timeout",
      runs: runs.map(runToJson),
    }),
  });
}

function runToJson(value: SubagentTaskSnapshot): JsonObject {
  return Object.freeze({
    taskId: value.taskId,
    status: value.status,
    runtimePresence: value.runtimePresence,
    ...(value.result === undefined
      ? {}
      : { result: value.result as unknown as JsonObject }),
    ...(value.errorCode === undefined ? {} : { errorCode: value.errorCode }),
  });
}

function taskOutputFailure(
  context: ToolExecutionContext,
  code: string,
  retryable: boolean,
): ToolError {
  return new ToolError({
    code,
    category: "execution",
    retryable,
    sideEffectStatus: "none",
    conversationId: context.conversationId,
    runId: context.runId,
    toolCallId: context.toolCallId,
    toolName: "TaskOutput",
    toolVersion: "1.0.0",
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
