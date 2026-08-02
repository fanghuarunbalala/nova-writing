/** Child-side RPC handler owning one constructed Conversation Runtime. */
import {
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  type ConversationRuntimeExit,
} from "../../../conversation/host/index.js";
import type { JsonValue } from "../../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type {
  RuntimeIpcErrorSnapshot,
  RuntimeIpcRequestErrorMapper,
  RuntimeIpcRequestHandler,
  RuntimeIpcRequestHandlerContext,
} from "../../../runtime/ipc/index.js";
import type {
  RuntimeChildCompositionContext,
  RuntimeChildCompositionFactory,
  RuntimeChildRuntime,
} from "./RuntimeChildCompositionFactory.js";
import { RuntimeChildRequestError } from "./RuntimeChildErrors.js";
import {
  RUNTIME_CHILD_ACK_STATUS,
  RUNTIME_CHILD_RPC_METHOD,
  captureRuntimeChildBootstrap,
  captureRuntimeChildInput,
  captureRuntimeChildShutdown,
} from "./RuntimeChildProtocol.js";

type RuntimeChildEndpointState =
  | "awaiting_bootstrap"
  | "starting"
  | "online"
  | "stopping"
  | "exited"
  | "closed";

export interface RuntimeChildEndpointOptions {
  readonly compositionFactory: RuntimeChildCompositionFactory;
  readonly compositionContext: RuntimeChildCompositionContext;
  readonly logger?: Logger;
}

export class RuntimeChildEndpoint
  implements RuntimeIpcRequestHandler, RuntimeIpcRequestErrorMapper
{
  readonly #compositionFactory: RuntimeChildCompositionFactory;
  readonly #compositionContext: RuntimeChildCompositionContext;
  readonly #logger: Logger;
  readonly #unexpectedExitPromise: Promise<ConversationRuntimeExit>;
  #resolveUnexpectedExit!: (exit: ConversationRuntimeExit) => void;
  #state: RuntimeChildEndpointState = "awaiting_bootstrap";
  #runtime?: RuntimeChildRuntime;
  #shutdownRequested = false;
  #tail: Promise<void> = Promise.resolve();
  #closePromise?: Promise<void>;

  constructor(options: RuntimeChildEndpointOptions) {
    this.#compositionFactory = options.compositionFactory;
    this.#compositionContext = options.compositionContext;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "runtime_child_endpoint",
    });
    this.#unexpectedExitPromise = new Promise((resolve) => {
      this.#resolveUnexpectedExit = resolve;
    });
  }

  handle(
    method: string,
    payload: JsonValue,
    _context: RuntimeIpcRequestHandlerContext,
  ): Promise<JsonValue> {
    return this.#serialize(() => this.#handleOnce(method, payload));
  }

  map(error: unknown): RuntimeIpcErrorSnapshot {
    if (error instanceof RuntimeChildRequestError) {
      return Object.freeze({
        code: error.code,
        category: error.category,
        retryable: error.retryable,
      });
    }
    return Object.freeze({
      code: "RUNTIME_CHILD_INTERNAL_FAILURE",
      category: "internal",
      retryable: false,
    });
  }

  waitForUnexpectedExit(): Promise<ConversationRuntimeExit> {
    return this.#unexpectedExitPromise;
  }

  close(): Promise<void> {
    this.#closePromise ??= this.#closeOnce();
    return this.#closePromise;
  }

  async #handleOnce(method: string, payload: JsonValue): Promise<JsonValue> {
    switch (method) {
      case RUNTIME_CHILD_RPC_METHOD.bootstrap:
        return this.#bootstrap(payload);
      case RUNTIME_CHILD_RPC_METHOD.dispatchInput:
        return this.#dispatchInput(payload);
      case RUNTIME_CHILD_RPC_METHOD.shutdown:
        return this.#shutdown(payload);
      default:
        throw new RuntimeChildRequestError(
          "RUNTIME_CHILD_METHOD_UNSUPPORTED",
          "protocol",
          false,
        );
    }
  }

  async #bootstrap(payload: JsonValue): Promise<JsonValue> {
    if (this.#state !== "awaiting_bootstrap") {
      throw stateError();
    }
    let bootstrap;
    try {
      bootstrap = captureRuntimeChildBootstrap(payload);
    } catch {
      throw invalidRequest();
    }
    this.#state = "starting";
    let runtime: RuntimeChildRuntime;
    try {
      runtime = await this.#compositionFactory.create(
        bootstrap,
        this.#compositionContext,
      );
    } catch {
      this.#state = "exited";
      throw new RuntimeChildRequestError(
        "RUNTIME_CHILD_COMPOSITION_FAILED",
        "internal",
        false,
      );
    }
    if (
      runtime.conversationId !== bootstrap.conversation.metadata.id ||
      runtime.runtimeInstanceId !== bootstrap.runtimeInstanceId
    ) {
      this.#state = "exited";
      throw new RuntimeChildRequestError(
        "RUNTIME_CHILD_RUNTIME_IDENTITY_MISMATCH",
        "conflict",
        false,
      );
    }
    this.#runtime = runtime;
    this.#observeRuntimeExit(runtime);
    let startup;
    try {
      startup = await runtime.start(bootstrap);
    } catch {
      this.#state = "exited";
      throw new RuntimeChildRequestError(
        "RUNTIME_CHILD_START_FAILED",
        "internal",
        false,
      );
    }
    if (this.#readState() === "exited") {
      throw new RuntimeChildRequestError(
        "RUNTIME_CHILD_START_FAILED",
        "internal",
        false,
      );
    }
    this.#state = "online";
    this.#logger.info("runtime.child.bootstrap_completed", {
      conversationId: runtime.conversationId,
      runtimeInstanceId: runtime.runtimeInstanceId,
      throughSequence: startup.throughSequence,
    });
    return {
      status: RUNTIME_CHILD_ACK_STATUS,
      conversationId: runtime.conversationId,
      runtimeInstanceId: runtime.runtimeInstanceId,
      throughSequence: startup.throughSequence,
    };
  }

  async #dispatchInput(payload: JsonValue): Promise<JsonValue> {
    if (this.#state !== "online" || !this.#runtime) throw stateError();
    let input;
    try {
      input = captureRuntimeChildInput(payload);
    } catch {
      throw invalidRequest();
    }
    if (input.conversationId !== this.#runtime.conversationId) {
      throw new RuntimeChildRequestError(
        "RUNTIME_CHILD_INPUT_IDENTITY_MISMATCH",
        "conflict",
        false,
      );
    }
    try {
      await this.#runtime.dispatchInput(input);
    } catch {
      throw new RuntimeChildRequestError(
        "RUNTIME_CHILD_DISPATCH_FAILED",
        "internal",
        false,
      );
    }
    return { status: RUNTIME_CHILD_ACK_STATUS };
  }

  async #shutdown(payload: JsonValue): Promise<JsonValue> {
    if (
      (this.#state !== "online" && this.#state !== "stopping") ||
      !this.#runtime
    ) {
      throw stateError();
    }
    let request;
    try {
      request = captureRuntimeChildShutdown(payload);
    } catch {
      throw invalidRequest();
    }
    this.#shutdownRequested = true;
    this.#state = "stopping";
    try {
      await this.#runtime.shutdown(request);
    } catch {
      throw new RuntimeChildRequestError(
        "RUNTIME_CHILD_SHUTDOWN_FAILED",
        "internal",
        false,
      );
    }
    return { status: RUNTIME_CHILD_ACK_STATUS };
  }

  async #closeOnce(): Promise<void> {
    if (this.#state === "closed") return;
    const runtime = this.#runtime;
    if (
      runtime !== undefined &&
      this.#state !== "exited" &&
      this.#state !== "stopping"
    ) {
      try {
        await runtime.shutdown({
          reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.hostClose,
        });
      } catch {
        this.#logger.warn("runtime.child.close_shutdown_failed");
      }
    }
    this.#state = "closed";
  }

  #observeRuntimeExit(runtime: RuntimeChildRuntime): void {
    void runtime.waitForExit().then(
      (exit) => {
        this.#state = "exited";
        if (!this.#shutdownRequested || exit.kind === "crashed") {
          this.#resolveUnexpectedExit(exit);
        }
      },
      () => {
        this.#state = "exited";
        this.#resolveUnexpectedExit(Object.freeze({
          kind: "crashed",
          exitedAt: new Date().toISOString(),
          errorName: "RuntimeChildExitObserverError",
          errorCode: "RUNTIME_CHILD_EXIT_OBSERVER_FAILED",
        }));
      },
    );
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #readState(): RuntimeChildEndpointState {
    return this.#state;
  }
}

function invalidRequest(): RuntimeChildRequestError {
  return new RuntimeChildRequestError(
    "RUNTIME_CHILD_REQUEST_INVALID",
    "validation",
    false,
  );
}

function stateError(): RuntimeChildRequestError {
  return new RuntimeChildRequestError(
    "RUNTIME_CHILD_STATE_INVALID",
    "conflict",
    false,
  );
}
