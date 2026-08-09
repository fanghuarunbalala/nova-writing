/**
 * Parent 侧白名单子代理窄 RPC Handler：经现成 host 与 command service 服务子代理生命周期。
 * Parent-side allowlisted subagent RPC Handler serving child-agent lifecycle
 * through the existing ConversationHost and ConversationCommandService.
 */
import { CONVERSATION_RUNTIME_ACTIVATION_REASON } from "../../../conversation/host/index.js";
import type { ConversationCommandService } from "../../../conversation/ConversationCommandService.js";
import { TaskAssignedInputEvent } from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  RUNTIME_SUBAGENT_RPC_METHOD,
  RuntimeSubagentProtocolError,
  captureRuntimeSubagentEnqueueRequest,
  captureRuntimeSubagentEnqueueResponse,
  captureRuntimeSubagentEnsureActiveRequest,
  captureRuntimeSubagentEnsureActiveResponse,
  captureRuntimeSubagentShutdownRuntimeRequest,
  captureRuntimeSubagentShutdownRuntimeResponse,
  encodeRuntimeSubagentPayload,
  isRuntimeSubagentRpcMethod,
  type RuntimeIpcErrorSnapshot,
  type RuntimeIpcRequestErrorMapper,
  type RuntimeIpcRequestHandler,
  type RuntimeIpcRequestHandlerContext,
  type RuntimeSubagentRpcMethod,
} from "../../../runtime/ipc/index.js";
import type { JsonValue } from "../../../event/index.js";
import type { ChildSubagentConversationHost } from "./ChildRuntimeSubagentClient.js";

export interface ParentRuntimeSubagentHandlerOptions {
  readonly host: ChildSubagentConversationHost;
  readonly commandService: ConversationCommandService;
  readonly logger?: Logger;
}

export class ParentRuntimeSubagentHandler
  implements RuntimeIpcRequestHandler, RuntimeIpcRequestErrorMapper
{
  readonly #host: ChildSubagentConversationHost;
  readonly #commandService: ConversationCommandService;
  readonly #logger: Logger;

  constructor(options: ParentRuntimeSubagentHandlerOptions) {
    this.#host = options.host;
    this.#commandService = options.commandService;
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
