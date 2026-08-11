/** Owns one child-process Runtime placement per active Conversation Runtime. */
import {
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  type ConversationRuntimeBootstrap,
  type ConversationRuntimeHandle,
  type ConversationRuntimePlacement,
} from "../../../conversation/host/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { RuntimeIpcConnection } from "../../../runtime/ipc/index.js";
import { NodeJsonlIpcConnection } from "../ipc/index.js";
import {
  ChildProcessConversationRuntimeHandle,
  type RuntimeChildProcessEndpoint,
} from "./ChildProcessConversationRuntimeHandle.js";
import {
  NodeConversationProcessActivationError,
  NodeConversationProcessConflictError,
  NodeConversationProcessSupervisorCloseError,
  NodeConversationProcessSupervisorClosedError,
} from "./NodeConversationProcessErrors.js";
import {
  RUNTIME_CHILD_PROCESS_TERMINATION_SIGNAL,
  type RuntimeChildProcess,
  type RuntimeChildProcessLauncher,
} from "./RuntimeChildProcessLauncher.js";
import { RuntimeProcessExitNormalizer } from "./RuntimeProcessExitNormalizer.js";

export interface RuntimeChildProcessEndpointFactoryRequest {
  readonly bootstrap: ConversationRuntimeBootstrap;
  readonly connection: RuntimeIpcConnection;
}

export interface RuntimeChildProcessEndpointFactory {
  connect(
    request: RuntimeChildProcessEndpointFactoryRequest,
  ): Promise<RuntimeChildProcessEndpoint>;
}

export interface NodeConversationProcessSupervisorOptions {
  readonly launcher: RuntimeChildProcessLauncher;
  readonly endpointFactory: RuntimeChildProcessEndpointFactory;
  readonly exitNormalizer?: RuntimeProcessExitNormalizer;
  readonly logger?: Logger;
}

export class NodeConversationProcessSupervisor
  implements ConversationRuntimePlacement
{
  readonly #launcher: RuntimeChildProcessLauncher;
  readonly #endpointFactory: RuntimeChildProcessEndpointFactory;
  readonly #exitNormalizer: RuntimeProcessExitNormalizer;
  readonly #logger: Logger;
  readonly #startingConversationIds = new Set<string>();
  readonly #startingRuntimeInstanceIds = new Set<string>();
  readonly #activeByConversationId = new Map<
    string,
    ChildProcessConversationRuntimeHandle
  >();
  readonly #activeByRuntimeInstanceId = new Map<
    string,
    ChildProcessConversationRuntimeHandle
  >();
  readonly #pendingActivations = new Set<Promise<ConversationRuntimeHandle>>();
  #closing = false;
  #closePromise?: Promise<void>;

  constructor(options: NodeConversationProcessSupervisorOptions) {
    this.#launcher = options.launcher;
    this.#endpointFactory = options.endpointFactory;
    this.#exitNormalizer = options.exitNormalizer ?? new RuntimeProcessExitNormalizer();
    this.#logger = (options.logger ?? noopLogger).child({
      component: "node_conversation_process_supervisor",
    });
  }

  get activeProcessCount(): number {
    return this.#activeByRuntimeInstanceId.size;
  }

  activate(
    bootstrap: ConversationRuntimeBootstrap,
  ): Promise<ConversationRuntimeHandle> {
    if (this.#closing) {
      return Promise.reject(new NodeConversationProcessSupervisorClosedError());
    }
    const conversationId = captureNonBlank(
      bootstrap?.conversation?.metadata?.id,
      "Conversation ID",
    );
    const runtimeInstanceId = captureNonBlank(
      bootstrap?.runtimeInstanceId,
      "Runtime instance ID",
    );
    if (
      this.#startingConversationIds.has(conversationId) ||
      this.#startingRuntimeInstanceIds.has(runtimeInstanceId) ||
      this.#activeByConversationId.has(conversationId) ||
      this.#activeByRuntimeInstanceId.has(runtimeInstanceId)
    ) {
      return Promise.reject(
        new NodeConversationProcessConflictError(
          conversationId,
          runtimeInstanceId,
        ),
      );
    }

    this.#startingConversationIds.add(conversationId);
    this.#startingRuntimeInstanceIds.add(runtimeInstanceId);
    const activation = this.#activateOnce(
      bootstrap,
      conversationId,
      runtimeInstanceId,
    );
    this.#pendingActivations.add(activation);
    void activation.then(
      () => this.#releaseActivation(activation, conversationId, runtimeInstanceId),
      () => this.#releaseActivation(activation, conversationId, runtimeInstanceId),
    );
    return activation;
  }

  close(): Promise<void> {
    this.#closing = true;
    this.#closePromise ??= this.#closeOnce();
    return this.#closePromise;
  }

  async #activateOnce(
    bootstrap: ConversationRuntimeBootstrap,
    conversationId: string,
    runtimeInstanceId: string,
  ): Promise<ConversationRuntimeHandle> {
    this.#logger.info("runtime.process.activation_started", {
      conversationId,
      runtimeInstanceId,
    });
    let process: RuntimeChildProcess | undefined;
    let connection: NodeJsonlIpcConnection | undefined;
    let endpoint: RuntimeChildProcessEndpoint | undefined;
    let stage: "launch" | "connect" = "launch";
    try {
      process = await this.#launcher.launch({ conversationId, runtimeInstanceId });
      if (this.#closing) throw new NodeConversationProcessSupervisorClosedError();
      connection = new NodeJsonlIpcConnection({
        readable: process.stdout,
        writable: process.stdin,
        logger: this.#logger.child({ conversationId, runtimeInstanceId }),
      });
      stage = "connect";
      endpoint = await this.#endpointFactory.connect({ bootstrap, connection });
      if (this.#closing) throw new NodeConversationProcessSupervisorClosedError();

      const handle = new ChildProcessConversationRuntimeHandle({
        conversationId,
        runtimeInstanceId,
        process,
        connection,
        endpoint,
        exitNormalizer: this.#exitNormalizer,
        logger: this.#logger,
        onExit: () => this.#releaseHandle(conversationId, runtimeInstanceId),
      });
      this.#activeByConversationId.set(conversationId, handle);
      this.#activeByRuntimeInstanceId.set(runtimeInstanceId, handle);
      this.#logger.info("runtime.process.activation_completed", {
        conversationId,
        runtimeInstanceId,
      });
      return handle;
    } catch (error) {
      await Promise.allSettled([
        ...(endpoint !== undefined ? [endpoint.close("supervisor_close")] : []),
        ...(connection !== undefined ? [connection.close()] : []),
      ]);
      process?.terminate(RUNTIME_CHILD_PROCESS_TERMINATION_SIGNAL.terminate);
      if (error instanceof NodeConversationProcessSupervisorClosedError) {
        throw error;
      }
      const identity = captureErrorIdentity(error);
      this.#logger.error("runtime.process.activation_failed", {
        conversationId,
        runtimeInstanceId,
        stage,
        ...identity,
      });
      throw new NodeConversationProcessActivationError(
        conversationId,
        runtimeInstanceId,
        stage,
        identity.errorName,
        identity.errorCode,
      );
    }
  }

  async #closeOnce(): Promise<void> {
    this.#logger.info("runtime.process.supervisor_close_started", {
      activeProcessCount: this.activeProcessCount,
      pendingActivationCount: this.#pendingActivations.size,
    });
    await Promise.allSettled([...this.#pendingActivations]);
    const handles = [...this.#activeByRuntimeInstanceId.values()];
    const results = await Promise.allSettled(
      handles.map((handle) =>
        handle.dispose(CONVERSATION_RUNTIME_SHUTDOWN_REASON.hostClose),
      ),
    );
    this.#activeByConversationId.clear();
    this.#activeByRuntimeInstanceId.clear();
    const failureCount = results.filter(
      (result) => result.status === "rejected",
    ).length;
    this.#logger.info("runtime.process.supervisor_close_completed", {
      processCount: handles.length,
      failureCount,
    });
    if (failureCount > 0) {
      throw new NodeConversationProcessSupervisorCloseError(failureCount);
    }
  }

  #releaseHandle(conversationId: string, runtimeInstanceId: string): void {
    const handle = this.#activeByRuntimeInstanceId.get(runtimeInstanceId);
    if (handle?.conversationId !== conversationId) return;
    this.#activeByRuntimeInstanceId.delete(runtimeInstanceId);
    this.#activeByConversationId.delete(conversationId);
  }

  #releaseActivation(
    activation: Promise<ConversationRuntimeHandle>,
    conversationId: string,
    runtimeInstanceId: string,
  ): void {
    this.#pendingActivations.delete(activation);
    this.#startingConversationIds.delete(conversationId);
    this.#startingRuntimeInstanceIds.delete(runtimeInstanceId);
  }
}

function captureErrorIdentity(error: unknown): Readonly<{
  errorName: string;
  errorCode?: string;
}> {
  if (!(error instanceof Error)) {
    return Object.freeze({ errorName: "UnknownError" });
  }
  const errorName = captureIdentity(error.name, "UnknownError");
  const candidate = (error as Error & { readonly code?: unknown }).code;
  const errorCode = typeof candidate === "string"
    ? captureIdentity(candidate, undefined)
    : undefined;
  return Object.freeze({
    errorName,
    ...(errorCode !== undefined ? { errorCode } : {}),
  });
}

function captureIdentity<T extends string | undefined>(
  value: unknown,
  fallback: T,
): string | T {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : fallback;
}

function captureNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be non-blank`);
  }
  return value;
}
