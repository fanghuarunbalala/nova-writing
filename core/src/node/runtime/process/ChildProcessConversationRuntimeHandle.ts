/** Placement-neutral Runtime Handle backed by one supervised child process. */
import {
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  type ConversationRuntimeExit,
  type ConversationRuntimeHandle,
  type ConversationRuntimeHandleShutdownRequest,
  type ConversationRuntimeInputReference,
  type ConversationRuntimeShutdownReason,
} from "../../../conversation/host/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { RuntimeIpcConnection } from "../../../runtime/ipc/index.js";
import { ChildProcessConversationRuntimeHandleError } from "./NodeConversationProcessErrors.js";
import {
  RUNTIME_CHILD_PROCESS_TERMINATION_SIGNAL,
  type RuntimeChildProcess,
} from "./RuntimeChildProcessLauncher.js";
import { RuntimeProcessExitNormalizer } from "./RuntimeProcessExitNormalizer.js";

export interface RuntimeChildProcessEndpoint {
  dispatchInput(input: ConversationRuntimeInputReference): Promise<void>;

  shutdown(request: ConversationRuntimeHandleShutdownRequest): Promise<void>;

  close(): Promise<void>;

  waitForUnhealthy?(): Promise<void>;
}

export interface ChildProcessConversationRuntimeHandleOptions {
  readonly conversationId: string;
  readonly runtimeInstanceId: string;
  readonly process: RuntimeChildProcess;
  readonly connection: RuntimeIpcConnection;
  readonly endpoint: RuntimeChildProcessEndpoint;
  readonly exitNormalizer?: RuntimeProcessExitNormalizer;
  readonly logger?: Logger;
  readonly onExit?: (exit: ConversationRuntimeExit) => void;
  readonly gracefulTerminationTimeoutMs?: number;
}

export class ChildProcessConversationRuntimeHandle
  implements ConversationRuntimeHandle
{
  readonly conversationId: string;
  readonly runtimeInstanceId: string;
  readonly #process: RuntimeChildProcess;
  readonly #connection: RuntimeIpcConnection;
  readonly #endpoint: RuntimeChildProcessEndpoint;
  readonly #exitNormalizer: RuntimeProcessExitNormalizer;
  readonly #logger: Logger;
  readonly #onExit?: (exit: ConversationRuntimeExit) => void;
  readonly #exitPromise: Promise<ConversationRuntimeExit>;
  readonly #gracefulTerminationTimeoutMs: number;
  #shutdownReason?: ConversationRuntimeShutdownReason;
  #shutdownPromise?: Promise<void>;
  #closeTransportPromise?: Promise<void>;
  #exited = false;

  constructor(options: ChildProcessConversationRuntimeHandleOptions) {
    this.conversationId = captureNonBlank(
      options.conversationId,
      "Conversation ID",
    );
    this.runtimeInstanceId = captureNonBlank(
      options.runtimeInstanceId,
      "Runtime instance ID",
    );
    this.#process = options.process;
    this.#connection = options.connection;
    this.#endpoint = options.endpoint;
    this.#exitNormalizer = options.exitNormalizer ?? new RuntimeProcessExitNormalizer();
    this.#logger = (options.logger ?? noopLogger).child({
      component: "child_process_conversation_runtime_handle",
      conversationId: this.conversationId,
      runtimeInstanceId: this.runtimeInstanceId,
    });
    this.#onExit = options.onExit;
    this.#gracefulTerminationTimeoutMs = capturePositiveInteger(options.gracefulTerminationTimeoutMs ?? 5_000);
    this.#exitPromise = this.#observeExit();
    if (this.#endpoint.waitForUnhealthy !== undefined) {
      void this.#endpoint.waitForUnhealthy().then(() => this.#terminateUnhealthy());
    }
  }

  async dispatchInput(input: ConversationRuntimeInputReference): Promise<void> {
    if (input?.conversationId !== this.conversationId) {
      throw new TypeError("Runtime input Conversation ID does not match Handle");
    }
    if (this.#shutdownReason !== undefined || this.#exited) {
      throw new ChildProcessConversationRuntimeHandleError(
        this.conversationId,
        this.runtimeInstanceId,
        "dispatch_input",
      );
    }
    try {
      await this.#endpoint.dispatchInput(input);
      this.#logger.debug("runtime.process.input_dispatched", {
        inputEventId: input.inputEventId,
        sequence: input.sequence,
      });
    } catch {
      throw new ChildProcessConversationRuntimeHandleError(
        this.conversationId,
        this.runtimeInstanceId,
        "dispatch_input",
      );
    }
  }

  shutdown(request: ConversationRuntimeHandleShutdownRequest): Promise<void> {
    const reason = captureShutdownReason(request?.reason);
    this.#shutdownReason ??= reason;
    if (this.#exited) return Promise.resolve();
    this.#shutdownPromise ??= this.#requestShutdown(this.#shutdownReason);
    return this.#shutdownPromise;
  }

  waitForExit(): Promise<ConversationRuntimeExit> {
    return this.#exitPromise;
  }

  async dispose(reason: ConversationRuntimeShutdownReason): Promise<void> {
    await this.shutdown({ reason: captureShutdownReason(reason) });
  }

  async #requestShutdown(reason: ConversationRuntimeShutdownReason): Promise<void> {
    this.#logger.info("runtime.process.shutdown_requested", {
      shutdownReason: reason,
    });
    let commandFailed = false;
    const graceful = this.#endpoint.shutdown({ reason }).catch(() => {
      commandFailed = true;
      this.#process.terminate(RUNTIME_CHILD_PROCESS_TERMINATION_SIGNAL.terminate);
    });
    const completed = await Promise.race([
      Promise.all([graceful, this.#exitPromise]).then(() => true),
      delay(this.#gracefulTerminationTimeoutMs).then(() => false),
    ]);
    if (!completed && !this.#exited) {
      this.#logger.warn("runtime.process.shutdown_forced");
      await this.#closeTransport();
      this.#process.terminate(RUNTIME_CHILD_PROCESS_TERMINATION_SIGNAL.kill);
      await this.#exitPromise;
    }
    if (commandFailed) {
      throw new ChildProcessConversationRuntimeHandleError(
        this.conversationId,
        this.runtimeInstanceId,
        "shutdown",
      );
    }
  }

  async #terminateUnhealthy(): Promise<void> {
    if (this.#exited || this.#shutdownReason !== undefined) return;
    this.#logger.warn("runtime.process.heartbeat_unhealthy");
    await this.#closeTransport();
    this.#process.terminate(RUNTIME_CHILD_PROCESS_TERMINATION_SIGNAL.terminate);
    const exited = await Promise.race([
      this.#exitPromise.then(() => true),
      delay(this.#gracefulTerminationTimeoutMs).then(() => false),
    ]);
    if (!exited && !this.#exited) {
      this.#logger.warn("runtime.process.unhealthy_forced");
      this.#process.terminate(RUNTIME_CHILD_PROCESS_TERMINATION_SIGNAL.kill);
    }
  }

  async #observeExit(): Promise<ConversationRuntimeExit> {
    const status = await this.#process.waitForExit();
    this.#exited = true;
    await this.#closeTransport();
    const exit = this.#exitNormalizer.normalize(status, this.#shutdownReason);
    this.#logger.info("runtime.process.exited", {
      exitKind: exit.kind,
      ...(exit.kind === "stopped"
        ? { shutdownReason: exit.reason }
        : {
            errorName: exit.errorName,
            ...(exit.errorCode !== undefined
              ? { errorCode: exit.errorCode }
              : {}),
          }),
    });
    try {
      this.#onExit?.(exit);
    } catch {
      this.#logger.warn("runtime.process.exit_observer_failed");
    }
    return exit;
  }

  #closeTransport(): Promise<void> {
    this.#closeTransportPromise ??= Promise.allSettled([
      this.#endpoint.close(),
      this.#connection.close(),
    ]).then((results) => {
      const failureCount = results.filter(
        (result) => result.status === "rejected",
      ).length;
      if (failureCount > 0) {
        this.#logger.warn("runtime.process.transport_close_failed", {
          failureCount,
        });
      }
    });
    return this.#closeTransportPromise;
  }
}

function captureShutdownReason(
  value: ConversationRuntimeShutdownReason,
): ConversationRuntimeShutdownReason {
  if (!Object.values(CONVERSATION_RUNTIME_SHUTDOWN_REASON).includes(value)) {
    throw new TypeError("Conversation Runtime shutdown reason is invalid");
  }
  return value;
}

function captureNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be non-blank`);
  }
  return value;
}

function capturePositiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Termination timeout must be positive");
  return value;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
