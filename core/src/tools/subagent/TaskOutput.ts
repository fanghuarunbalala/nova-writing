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
        "读取异步子代理任务的运行状态与结果。\n\n用法：\n- runIds 指定要查询的一个或多个任务（至少 1 个）。\n- block=false（默认）：立即返回当前状态快照，不等待。\n- block=true：轮询直到任一任务到达终态（completed / failed / cancelled / orphaned）或 timeout 到期才返回。\n- 本工具不会激活任何子进程运行时。",
      parameters: SubagentTaskOutputParametersSchema,
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        const captured = captureSubagentTaskOutputArguments(arguments_);
        logger.info("runtime.subagent.task_output_tool.invoked", {
          parentConversationId: context.conversationId,
          parentRunId: context.runId,
          runIds: captured.runIds.join(","),
          block: captured.block === true,
          timeout: captured.timeout,
        });
        if (!captured.block) {
          const runs = await queryAll(context, options.query, captured.runIds);
          logger.info("runtime.subagent.task_output_tool.snapshot", {
            parentConversationId: context.conversationId,
            parentRunId: context.runId,
            runStatuses: runs.map((run) => `${run.taskId}:${run.status}`).join(","),
            hasResult: runs.some((run) => run.result !== undefined),
          });
          return snapshotResult(runs);
        }
        const deadline = timeSource.now() + captured.timeout;
        let previous: string | undefined;
        try {
          while (true) {
            context.signal.throwIfAborted();
            const runs = await queryAll(context, options.query, captured.runIds);
            const signature = runs
              .map((run) => `${run.taskId}:${run.status}`)
              .join(",");
            if (signature !== previous) {
              logger.info("runtime.subagent.task_output_tool.poll", {
                parentConversationId: context.conversationId,
                parentRunId: context.runId,
                runStatuses: signature,
              });
              previous = signature;
            }
            const terminalIndex = runs.findIndex((run) =>
              TERMINAL_STATUSES.has(run.status),
            );
            if (terminalIndex !== -1) {
              logger.info("runtime.subagent.task_output_tool.returned", {
                parentConversationId: context.conversationId,
                parentRunId: context.runId,
                retrieval: "completed",
                runStatuses: signature,
              });
              return successResult(runs, terminalIndex);
            }
            if (timeSource.now() >= deadline) {
              logger.info("runtime.subagent.task_output_tool.returned", {
                parentConversationId: context.conversationId,
                parentRunId: context.runId,
                retrieval: "timeout",
                runStatuses: signature,
              });
              return timeoutResult(runs);
            }
            await sleep(pollIntervalMs);
          }
        } catch (error) {
          if (isAbortError(error)) {
            logger.info("runtime.subagent.task_output_tool.returned", {
              parentConversationId: context.conversationId,
              parentRunId: context.runId,
              retrieval: "aborted",
            });
          }
          throw error;
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
  // 正文必须进 content：provider 当轮只序列化 content，details 仅供 journal
  // 重建（readResult.formatReadToolResult 的同款约定）。runs 里每个有 result
  // 的 run 都拼上状态+正文，让模型可见完整输出。
  // The provider only serializes content in the live turn; details is reserved
  // for journal rebuild (same convention as readResult.formatReadToolResult).
  // Each run's status line plus its result body is joined into the content.
  const lines: string[] = [`${runs.length} run(s).`];
  for (const run of runs) {
    lines.push(runText(run, /* listPrefix */ true));
  }
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({
        type: "text" as const,
        text: lines.join("\n"),
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
  // 正文拼进 content（同 snapshotResult 的理由）；无 result 时退回纯状态行。
  // The terminal run's body is appended to content; without a result the
  // status line alone is kept.
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({
        type: "text" as const,
        text: runText(run, /* listPrefix */ false),
      }),
    ]),
    details: Object.freeze({
      retrieval: "success",
      run: runToJson(run),
      otherRuns: otherRuns.map(runToJson),
    }),
  });
}

// Model-visible text for a single run: status line, plus the result body when
// present. listPrefix=true renders "- {taskId}: {status}" for snapshots.
function runText(run: SubagentTaskSnapshot, listPrefix: boolean): string {
  const statusLine = listPrefix
    ? `- ${run.taskId}: ${run.status}`
    : `Run ${run.taskId} reached ${run.status}.`;
  return run.result === undefined
    ? statusLine
    : `${statusLine}\n\n${run.result.content}`;
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

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
