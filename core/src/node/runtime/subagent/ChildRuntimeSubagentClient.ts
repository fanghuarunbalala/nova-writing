/**
 * Child 侧 Runtime 子代理窄 RPC 客户端：仅暴露类型化窄端口给子代理 manager。
 * Child-side Runtime subagent client exposing only typed narrow Ports to the
 * subagent manager (host activation/shutdown and task enqueue).
 */
import {
  CONVERSATION_RUNTIME_ACTIVATION_REASON,
  type ConversationHost,
} from "../../../conversation/host/index.js";
import type { ConversationCommandService } from "../../../conversation/ConversationCommandService.js";
import type { InputEvent, JsonValue } from "../../../event/index.js";
import { TaskAssignedInputEvent, TaskAssignedPayload } from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  RUNTIME_SUBAGENT_RPC_METHOD,
  RuntimeIpcRemoteError,
  RuntimeIpcRequestCancelledError,
  RuntimeSubagentRequestError,
  captureRuntimeSubagentEnqueueRequest,
  captureRuntimeSubagentEnqueueResponse,
  captureRuntimeSubagentEnsureActiveRequest,
  captureRuntimeSubagentEnsureActiveResponse,
  captureRuntimeSubagentShutdownRuntimeRequest,
  captureRuntimeSubagentShutdownRuntimeResponse,
  encodeRuntimeSubagentPayload,
  type RuntimeIpcRequestOptions,
  type RuntimeSubagentRpcMethod,
} from "../../../runtime/ipc/index.js";

export interface RuntimeSubagentRpcRequester {
  request(
    method: string,
    payload: JsonValue,
    options?: RuntimeIpcRequestOptions,
  ): Promise<JsonValue>;
}

export interface ChildRuntimeSubagentClientOptions {
  readonly requester: RuntimeSubagentRpcRequester;
  readonly logger?: Logger;
}

/**
 * 子代理 manager 需要的窄 host 视图：仅激活/关闭，不含通知与 presence。
 * Narrow host view consumed by the subagent manager.
 */
export type ChildSubagentConversationHost = Pick<
  ConversationHost,
  "ensureActive" | "shutdownRuntime"
>;

/**
 * 子代理 manager 需要的窄命令视图：仅入队 Task 输入。
 * Narrow command view consumed by the subagent manager.
 */
export type ChildSubagentConversationCommandService = Pick<
  ConversationCommandService,
  "enqueue"
>;

export class ChildRuntimeSubagentClient {
  readonly host: ChildSubagentConversationHost;
  readonly commandService: ChildSubagentConversationCommandService;
  readonly #requester: RuntimeSubagentRpcRequester;
  readonly #logger: Logger;

  constructor(options: ChildRuntimeSubagentClientOptions) {
    this.#requester = options.requester;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "child_runtime_subagent_client",
    });
    this.host = Object.freeze({
      ensureActive: async (request) => {
        if (request.reason !== CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore) {
          throw new RuntimeSubagentRequestError(
            RUNTIME_SUBAGENT_RPC_METHOD.ensureActive,
            "remote_failure",
          );
        }
        const rpcRequest = captureRuntimeSubagentEnsureActiveRequest({
          conversationId: request.conversationId,
        });
        return captureRuntimeSubagentEnsureActiveResponse(
          await this.#request(RUNTIME_SUBAGENT_RPC_METHOD.ensureActive, rpcRequest),
        );
      },
      shutdownRuntime: async (request) => {
        const rpcRequest = captureRuntimeSubagentShutdownRuntimeRequest({
          conversationId: request.conversationId,
          reason: request.reason,
        });
        return captureRuntimeSubagentShutdownRuntimeResponse(
          await this.#request(RUNTIME_SUBAGENT_RPC_METHOD.shutdownRuntime, rpcRequest),
        );
      },
    } satisfies ChildSubagentConversationHost);
    this.commandService = Object.freeze({
      enqueue: async (conversationId, event) => {
        const task = captureTaskAssignedPayload(event);
        const rpcRequest = captureRuntimeSubagentEnqueueRequest({
          conversationId,
          taskId: task.taskId,
          requesterConversationId: task.requesterConversationId,
          prompt: task.prompt,
          artifactReferences: task.artifactReferences,
        });
        return captureRuntimeSubagentEnqueueResponse(
          await this.#request(RUNTIME_SUBAGENT_RPC_METHOD.enqueue, rpcRequest),
          rpcRequest,
        );
      },
    } satisfies ChildSubagentConversationCommandService);
    Object.freeze(this);
  }

  async #request(
    method: RuntimeSubagentRpcMethod,
    request: unknown,
    options?: RuntimeIpcRequestOptions,
  ): Promise<JsonValue> {
    this.#logger.debug("runtime.subagent.client_request_started", { method });
    try {
      const response = await this.#requester.request(
        method,
        encodeRuntimeSubagentPayload(request),
        { signal: options?.signal },
      );
      this.#logger.debug("runtime.subagent.client_request_completed", { method });
      return response;
    } catch (error) {
      if (
        error instanceof RuntimeIpcRequestCancelledError ||
        (error instanceof RuntimeIpcRemoteError && error.category === "cancelled")
      ) {
        throw new RuntimeSubagentRequestError(method, "cancelled");
      }
      throw new RuntimeSubagentRequestError(method, "remote_failure");
    }
  }
}

function captureTaskAssignedPayload(
  event: InputEvent,
): TaskAssignedPayload {
  if (!(event instanceof TaskAssignedInputEvent)) {
    throw new TypeError("Runtime subagent enqueue requires a Task-assigned input event");
  }
  return event.getPayload() as TaskAssignedPayload;
}
