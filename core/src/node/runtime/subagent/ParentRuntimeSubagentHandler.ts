/**
 * Parent 侧白名单子代理窄 RPC Handler：经现成 host 与 command service 服务子代理生命周期。
 * Parent-side allowlisted subagent RPC Handler serving child-agent lifecycle
 * through the existing ConversationHost and ConversationCommandService.
 */
import { CONVERSATION_RUNTIME_ACTIVATION_REASON } from "../../../conversation/host/index.js";
import type { ConversationCommandService } from "../../../conversation/ConversationCommandService.js";
import {
  OUTPUT_EVENT_TYPE,
  TaskAssignedInputEvent,
} from "../../../event/index.js";
import type { JsonValue } from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import { RUN_STATUS } from "../../../runtime/execution/index.js";
import {
  RUNTIME_SUBAGENT_RPC_METHOD,
  RuntimeSubagentProtocolError,
  captureRuntimeSubagentEnqueueRequest,
  captureRuntimeSubagentEnqueueResponse,
  captureRuntimeSubagentEnsureActiveRequest,
  captureRuntimeSubagentEnsureActiveResponse,
  captureRuntimeSubagentReadChildFinalAssistantMessageRequest,
  captureRuntimeSubagentReadChildFinalAssistantMessageResponse,
  captureRuntimeSubagentReadChildRunTerminalRequest,
  captureRuntimeSubagentReadChildRunTerminalResponse,
  captureRuntimeSubagentShutdownRuntimeRequest,
  captureRuntimeSubagentShutdownRuntimeResponse,
  encodeRuntimeSubagentPayload,
  isRuntimeSubagentRpcMethod,
  type RuntimeIpcErrorSnapshot,
  type RuntimeIpcRequestErrorMapper,
  type RuntimeIpcRequestHandler,
  type RuntimeIpcRequestHandlerContext,
  type RuntimeSubagentChildRunTerminalStatus,
  type RuntimeSubagentReadChildFinalAssistantMessageResponse,
  type RuntimeSubagentReadChildRunTerminalResponse,
  type RuntimeSubagentRpcMethod,
} from "../../../runtime/ipc/index.js";
import type {
  ConversationEventQuery,
  ConversationJournalReader,
  PersistedConversationEventSnapshot,
} from "../../../storage/index.js";
import type { ChildSubagentConversationHost } from "./ChildRuntimeSubagentClient.js";

export interface ParentRuntimeSubagentHandlerOptions {
  readonly host: ChildSubagentConversationHost;
  readonly commandService: ConversationCommandService;
  readonly journalReader: ConversationJournalReader;
  readonly logger?: Logger;
}

export class ParentRuntimeSubagentHandler
  implements RuntimeIpcRequestHandler, RuntimeIpcRequestErrorMapper
{
  readonly #host: ChildSubagentConversationHost;
  readonly #commandService: ConversationCommandService;
  readonly #journalReader: ConversationJournalReader;
  readonly #logger: Logger;

  constructor(options: ParentRuntimeSubagentHandlerOptions) {
    this.#host = options.host;
    this.#commandService = options.commandService;
    this.#journalReader = options.journalReader;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "parent_runtime_subagent_handler",
    });
  }

  async handle(
    method: string,
    payload: JsonValue,
    context: RuntimeIpcRequestHandlerContext,
  ): Promise<JsonValue> {
    if (!isRuntimeSubagentRpcMethod(method)) {
      throw new RuntimeSubagentProtocolError("method_not_allowed");
    }
    this.#logger.debug("runtime.subagent.request_started", {
      method,
      requestId: context.requestId,
    });
    const response = await this.#dispatch(method, payload, context.signal);
    this.#logger.debug("runtime.subagent.request_completed", {
      method,
      requestId: context.requestId,
    });
    return response;
  }

  map(error: unknown, context: RuntimeIpcRequestHandlerContext): RuntimeIpcErrorSnapshot {
    if (context.signal.aborted || error instanceof RuntimeSubagentAbortError) {
      return Object.freeze({
        code: "RUNTIME_SUBAGENT_CANCELLED",
        category: "cancelled",
        retryable: false,
      });
    }
    if (error instanceof RuntimeSubagentProtocolError) {
      return Object.freeze({
        code: error.failure === "method_not_allowed"
          ? "RUNTIME_SUBAGENT_METHOD_NOT_ALLOWED"
          : "RUNTIME_SUBAGENT_PROTOCOL_INVALID",
        category: error.failure === "identity_mismatch"
          ? "conflict"
          : error.failure === "method_not_allowed"
            ? "protocol"
            : "validation",
        retryable: false,
      });
    }
    return Object.freeze({
      code: "RUNTIME_SUBAGENT_UNAVAILABLE",
      category: "unavailable",
      retryable: true,
    });
  }

  async #dispatch(
    method: RuntimeSubagentRpcMethod,
    payload: JsonValue,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    switch (method) {
      case RUNTIME_SUBAGENT_RPC_METHOD.ensureActive:
        return this.#ensureActive(payload, signal);
      case RUNTIME_SUBAGENT_RPC_METHOD.shutdownRuntime:
        return this.#shutdownRuntime(payload, signal);
      case RUNTIME_SUBAGENT_RPC_METHOD.enqueue:
        return this.#enqueue(payload, signal);
      case RUNTIME_SUBAGENT_RPC_METHOD.readChildRunTerminal:
        return this.#readChildRunTerminal(payload, signal);
      case RUNTIME_SUBAGENT_RPC_METHOD.readChildFinalAssistantMessage:
        return this.#readChildFinalAssistantMessage(payload, signal);
    }
  }

  async #ensureActive(payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = captureRuntimeSubagentEnsureActiveRequest(payload);
    const result = await abortable(
      this.#host.ensureActive({
        conversationId: request.conversationId,
        reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
      }),
      signal,
    );
    return encodeRuntimeSubagentPayload(
      captureRuntimeSubagentEnsureActiveResponse(result),
    );
  }

  async #shutdownRuntime(payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = captureRuntimeSubagentShutdownRuntimeRequest(payload);
    const result = await abortable(
      this.#host.shutdownRuntime({
        conversationId: request.conversationId,
        reason: request.reason,
      }),
      signal,
    );
    return encodeRuntimeSubagentPayload(
      captureRuntimeSubagentShutdownRuntimeResponse(result),
    );
  }

  async #enqueue(payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = captureRuntimeSubagentEnqueueRequest(payload);
    const receipt = await abortable(
      this.#commandService.enqueue(
        request.conversationId,
        new TaskAssignedInputEvent({
          id: `task-assigned-${request.taskId}`,
          conversationId: request.conversationId,
          correlationId: request.requesterConversationId,
          causationId: request.taskId,
          taskId: request.taskId,
          requesterConversationId: request.requesterConversationId,
          prompt: request.prompt,
          artifactReferences: request.artifactReferences,
        }),
      ),
      signal,
    );
    const captured = captureRuntimeSubagentEnqueueResponse(receipt, request);
    this.#logger.info("runtime.subagent.task_queued", {
      taskId: request.taskId,
      status: captured.status,
      sequence: captured.sequence,
    });
    return encodeRuntimeSubagentPayload(captured);
  }

  async #readChildRunTerminal(
    payload: JsonValue,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    const request = captureRuntimeSubagentReadChildRunTerminalRequest(payload);
    const page = await abortable(
      this.#journalReader.list(CHILD_RUN_TERMINAL_QUERY(request.conversationId)),
      signal,
    );
    const response = toReadChildRunTerminalResponse(page.events[0]);
    return encodeRuntimeSubagentPayload(
      captureRuntimeSubagentReadChildRunTerminalResponse(response),
    );
  }

  async #readChildFinalAssistantMessage(
    payload: JsonValue,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    const request = captureRuntimeSubagentReadChildFinalAssistantMessageRequest(payload);
    const page = await abortable(
      this.#journalReader.list(CHILD_FINAL_MESSAGE_QUERY(request.conversationId)),
      signal,
    );
    const response = toReadChildFinalAssistantMessageResponse(page.events[0]);
    return encodeRuntimeSubagentPayload(
      captureRuntimeSubagentReadChildFinalAssistantMessageResponse(response),
    );
  }
}

const CHILD_RUN_TERMINAL_QUERY = (
  conversationId: string,
): ConversationEventQuery => Object.freeze({
  conversationId,
  eventTypes: [OUTPUT_EVENT_TYPE.agentRunStateChanged],
  anchor: { from: "end" } as const,
  limit: 1,
});

const CHILD_FINAL_MESSAGE_QUERY = (
  conversationId: string,
): ConversationEventQuery => Object.freeze({
  conversationId,
  eventTypes: [OUTPUT_EVENT_TYPE.agentAssistantMessageCompleted],
  anchor: { from: "end" } as const,
  limit: 1,
});

function toReadChildRunTerminalResponse(
  event: PersistedConversationEventSnapshot | undefined,
): RuntimeSubagentReadChildRunTerminalResponse {
  if (event === undefined || event.direction !== "output") {
    return Object.freeze({ found: false });
  }
  // 已按 eventTypes 过滤为 agent.run.state.changed 输出事件；payload.current 为
  // RunStatus 字符串（completed/failed/cancelled/queued/active…），仅终态可观察。
  // The filtered event payload carries `current` as a RunStatus string; only
  // terminal statuses are observable.
  const status = currentStatus((event.payload as { current?: unknown }).current);
  if (status === undefined) return Object.freeze({ found: false });
  // failed/cancelled 的细节字段由 bridge 兜底（SUBAGENT_RUN_FAILED / explicit），
  // run-state 的 reason 与取消原因不满足子代理协议枚举格式，不透传。
  return Object.freeze({
    found: true,
    status,
    completedAt: event.timestamp,
  });
}

function currentStatus(
  current: unknown,
): RuntimeSubagentChildRunTerminalStatus | undefined {
  if (typeof current !== "string") return undefined;
  if (current === RUN_STATUS.completed) return "completed";
  if (current === RUN_STATUS.failed) return "failed";
  if (current === RUN_STATUS.cancelled) return "cancelled";
  return undefined;
}

function toReadChildFinalAssistantMessageResponse(
  event: PersistedConversationEventSnapshot | undefined,
): RuntimeSubagentReadChildFinalAssistantMessageResponse {
  if (event === undefined || event.direction !== "output") {
    return Object.freeze({ found: false });
  }
  // 已按 eventTypes 过滤为 agent.assistant.message.completed 输出事件；从
  // payload.content 提取 text 项拼装正文。无正文（纯思考）视为未找到。
  // Extracts the final assistant text from the completed-message event payload.
  const content = extractMessageText((event.payload as { content?: unknown }).content);
  if (content.length === 0) return Object.freeze({ found: false });
  return Object.freeze({ found: true, content });
}

function extractMessageText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as { type?: unknown; text?: unknown };
    if (record.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  return parts.join("\n");
}

class RuntimeSubagentAbortError extends Error {
  constructor() {
    super("Runtime subagent operation was cancelled");
    this.name = "RuntimeSubagentAbortError";
  }
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new RuntimeSubagentAbortError());
  return new Promise<T>((resolve, reject) => {
    const cancelled = () => reject(new RuntimeSubagentAbortError());
    signal.addEventListener("abort", cancelled, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", cancelled);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", cancelled);
        reject(error);
      },
    );
  });
}
