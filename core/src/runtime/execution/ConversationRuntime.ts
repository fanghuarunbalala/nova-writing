/**
 * In-process Runtime shell that composes durable startup and live Input routing.
 *
 * Provider Turns, Stop effects, Tools, Policy, IPC, and child execution remain
 * outside this lifecycle boundary until their documented tasks are implemented.
 */
import type { ConversationRuntimeBootstrap } from "../../conversation/host/ConversationRuntimeBootstrap.js";
import type { ConversationRuntimeExit } from "../../conversation/host/ConversationRuntimeExit.js";
import type { ConversationRuntimeHandle } from "../../conversation/host/ConversationRuntimeHandle.js";
import type { ConversationRuntimeInputReference } from "../../conversation/host/ConversationRuntimeInputReference.js";
import {
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  type ConversationRuntimeHandleShutdownRequest,
  type ConversationRuntimeShutdownReason,
} from "../../conversation/host/ConversationRuntimeShutdown.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { PersistedInputEventSnapshot } from "../../storage/journal/PersistedConversationEventSnapshot.js";
import {
  RuntimeInputConflictError,
  RuntimeInputQueueFullError,
  RuntimeInputRejectedError,
} from "./input/RuntimeInputErrors.js";
import type { RuntimeInputRouteResult } from "./input/InputRouter.js";
import type { RuntimeInputPumpExit } from "./input/RuntimeInputPump.js";
import { RuntimeInputResolutionError } from "./source/RuntimeInputResolutionError.js";
import type { RuntimeInputResolver } from "./source/RuntimeInputResolver.js";
import type { RuntimeBootstrapStartupResult } from "./startup/RuntimeBootstrapStartupCoordinator.js";
import { RuntimeBootstrapStartupError } from "./startup/RuntimeBootstrapStartupError.js";
import {
  CONVERSATION_RUNTIME_OPERATION,
  ConversationRuntimeDispatchFailureError,
  ConversationRuntimeInputPumpError,
  ConversationRuntimeStartError,
  ConversationRuntimeStateError,
  type ConversationRuntimeInputPumpFailureScope,
} from "./ConversationRuntimeErrors.js";
import {
  CONVERSATION_RUNTIME_STATE,
  type ConversationRuntimeState,
} from "./ConversationRuntimeState.js";

export interface ConversationRuntimeStarter {
  start(bootstrap: ConversationRuntimeBootstrap): Promise<RuntimeBootstrapStartupResult>;
}

export interface ConversationRuntimeClock {
  now(): string;
}

export interface ConversationRuntimeInputRouter {
  route(input: PersistedInputEventSnapshot): RuntimeInputRouteResult;
}

export interface ConversationRuntimeInputPump {
  start(): void;
  wake(): void;
  stop(): Promise<void>;
  waitForExit(): Promise<RuntimeInputPumpExit>;
}

export interface ConversationRuntimeOptions {
  conversationId: string;
  runtimeInstanceId: string;
  startupCoordinator: ConversationRuntimeStarter;
  inputResolver: RuntimeInputResolver;
  inputRouter: ConversationRuntimeInputRouter;
  inputPump: ConversationRuntimeInputPump;
  clock?: ConversationRuntimeClock;
  logger?: Logger;
}

export class ConversationRuntime implements ConversationRuntimeHandle {
  readonly conversationId: string;
  readonly runtimeInstanceId: string;
  private readonly startupCoordinator: ConversationRuntimeStarter;
  private readonly inputResolver: RuntimeInputResolver;
  private readonly inputRouter: ConversationRuntimeInputRouter;
  private readonly inputPump: ConversationRuntimeInputPump;
  private readonly clock: ConversationRuntimeClock;
  private readonly logger: Logger;
  private readonly exitPromise: Promise<ConversationRuntimeExit>;
  private resolveExit!: (exit: ConversationRuntimeExit) => void;
  private lifecycleState: ConversationRuntimeState = CONVERSATION_RUNTIME_STATE.created;
  private tail: Promise<void> = Promise.resolve();
  private startRequested = false;
  private shutdownRequested = false;
  private shutdownPromise?: Promise<void>;
  private exit?: ConversationRuntimeExit;

  constructor(options: ConversationRuntimeOptions) {
    assertNonBlank("Conversation ID", options.conversationId);
    assertNonBlank("Runtime instance ID", options.runtimeInstanceId);
    this.conversationId = options.conversationId;
    this.runtimeInstanceId = options.runtimeInstanceId;
    this.startupCoordinator = options.startupCoordinator;
    this.inputResolver = options.inputResolver;
    this.inputRouter = options.inputRouter;
    this.inputPump = options.inputPump;
    this.clock = options.clock ?? SYSTEM_RUNTIME_CLOCK;
    this.logger = (options.logger ?? noopLogger).child({
      component: "conversation_runtime",
      conversationId: this.conversationId,
      runtimeInstanceId: this.runtimeInstanceId,
    });
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    this.observeInputPumpExit();
  }

  get state(): ConversationRuntimeState {
    return this.lifecycleState;
  }

  start(bootstrap: ConversationRuntimeBootstrap): Promise<RuntimeBootstrapStartupResult> {
    if (
      this.startRequested ||
      this.shutdownRequested ||
      this.lifecycleState !== CONVERSATION_RUNTIME_STATE.created
    ) {
      return Promise.reject(
        this.stateError(CONVERSATION_RUNTIME_OPERATION.start),
      );
    }
    this.startRequested = true;

    return this.serialize(async () => {
      this.transitionTo(CONVERSATION_RUNTIME_STATE.starting, "start_requested");
      this.logger.info("runtime.lifecycle.start_started");
      try {
        const result = await this.startupCoordinator.start(bootstrap);
        if (!this.shutdownRequested) {
          this.inputPump.start();
          this.transitionTo(CONVERSATION_RUNTIME_STATE.online, "startup_completed");
        }
        this.logger.info("runtime.lifecycle.start_completed", {
          throughSequence: result.throughSequence,
          routedInputCount: result.routedInputCount,
          shutdownPending: this.shutdownRequested,
        });
        return result;
      } catch (error) {
        const identity = getSafeErrorIdentity(error);
        const failure = new ConversationRuntimeStartError(
          this.conversationId,
          this.runtimeInstanceId,
          identity.errorName,
          identity.errorCode,
        );
        this.transitionTo(CONVERSATION_RUNTIME_STATE.crashed, "startup_failed");
        this.requestInputPumpStop();
        this.completeExit(
          Object.freeze({
            kind: "crashed",
            exitedAt: this.readTimestamp(),
            errorName: failure.name,
            errorCode: failure.code,
          }),
        );
        this.logger.error("runtime.lifecycle.start_failed", {
          failureName: identity.errorName,
          ...(identity.errorCode !== undefined
            ? { failureCode: identity.errorCode }
            : {}),
        });
        throw failure;
      }
    });
  }

  dispatchInput(reference: ConversationRuntimeInputReference): Promise<void> {
    if (
      this.shutdownRequested ||
      this.lifecycleState !== CONVERSATION_RUNTIME_STATE.online
    ) {
      return Promise.reject(
        this.stateError(CONVERSATION_RUNTIME_OPERATION.dispatchInput),
      );
    }

    return this.serialize(async () => {
      if (this.lifecycleState !== CONVERSATION_RUNTIME_STATE.online) {
        throw this.stateError(CONVERSATION_RUNTIME_OPERATION.dispatchInput);
      }
      this.logger.debug("runtime.input.dispatch_started", {
        sequence: safeSequence(reference?.sequence),
      });
      try {
        const input = await this.inputResolver.resolve(reference);
        const route = this.inputRouter.route(input);
        this.inputPump.wake();
        this.logger.info("runtime.input.dispatch_completed", {
          eventId: input.id,
          eventType: input.eventType,
          sequence: route.sequence,
          lane: route.lane,
          routeStatus: route.status,
        });
      } catch (error) {
        const identity = getSafeErrorIdentity(error);
        if (isRecoverableInputFailure(error)) {
          this.logger.warn("runtime.input.dispatch_rejected", {
            sequence: safeSequence(reference?.sequence),
            failureName: identity.errorName,
            ...(identity.errorCode !== undefined
              ? { failureCode: identity.errorCode }
              : {}),
          });
          throw error;
        }

        const failure = new ConversationRuntimeDispatchFailureError(
          this.conversationId,
          this.runtimeInstanceId,
          identity.errorName,
          identity.errorCode,
        );
        this.transitionTo(CONVERSATION_RUNTIME_STATE.crashed, "dispatch_failed");
        this.requestInputPumpStop();
        this.completeExit(
          Object.freeze({
            kind: "crashed",
            exitedAt: this.readTimestamp(),
            errorName: failure.name,
            errorCode: failure.code,
          }),
        );
        this.logger.error("runtime.input.dispatch_failed", {
          sequence: safeSequence(reference?.sequence),
          failureName: identity.errorName,
          ...(identity.errorCode !== undefined
            ? { failureCode: identity.errorCode }
            : {}),
        });
        throw failure;
      }
    });
  }

  shutdown(request: ConversationRuntimeHandleShutdownRequest): Promise<void> {
    let reason: ConversationRuntimeShutdownReason;
    try {
      reason = captureShutdownReason(request);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    if (
      this.lifecycleState === CONVERSATION_RUNTIME_STATE.stopped ||
      this.lifecycleState === CONVERSATION_RUNTIME_STATE.crashed
    ) {
      return Promise.resolve();
    }

    this.shutdownRequested = true;
    this.shutdownPromise = this.serialize(async () => {
      if (
        this.lifecycleState === CONVERSATION_RUNTIME_STATE.stopped ||
        this.lifecycleState === CONVERSATION_RUNTIME_STATE.crashed
      ) {
        return;
      }
      this.transitionTo(CONVERSATION_RUNTIME_STATE.stopping, reason);
      this.logger.info("runtime.lifecycle.shutdown_started", {
        shutdownReason: reason,
      });
      let pumpExit: RuntimeInputPumpExit;
      try {
        await this.inputPump.stop();
        pumpExit = await this.inputPump.waitForExit();
      } catch {
        throw this.failFromInputPump("shutdown");
      }
      if (pumpExit.kind !== "stopped") {
        throw this.failFromInputPump(captureInputPumpFailureScope(pumpExit));
      }
      this.transitionTo(CONVERSATION_RUNTIME_STATE.stopped, reason);
      this.completeExit(
        Object.freeze({
          kind: "stopped",
          exitedAt: this.readTimestamp(),
          reason,
        }),
      );
      this.logger.info("runtime.lifecycle.shutdown_completed", {
        shutdownReason: reason,
      });
    });
    return this.shutdownPromise;
  }

  waitForExit(): Promise<ConversationRuntimeExit> {
    return this.exitPromise;
  }

  private transitionTo(state: ConversationRuntimeState, reason: string): void {
    const previousState = this.lifecycleState;
    this.lifecycleState = state;
    this.logger.info("runtime.lifecycle.state_changed", {
      previousState,
      state,
      reason,
    });
  }

  private completeExit(exit: ConversationRuntimeExit): void {
    if (this.exit !== undefined) return;
    this.exit = exit;
    this.resolveExit(exit);
  }

  private observeInputPumpExit(): void {
    void Promise.resolve()
      .then(() => this.inputPump.waitForExit())
      .then(
        (exit) => {
          void this.serialize(async () => {
            if (
              this.lifecycleState === CONVERSATION_RUNTIME_STATE.stopped ||
              this.lifecycleState === CONVERSATION_RUNTIME_STATE.crashed
            ) {
              return;
            }
            if (exit.kind === "stopped" && this.shutdownRequested) return;
            const scope =
              exit.kind === "failed"
                ? captureInputPumpFailureScope(exit)
                : "unexpected_stop";
            this.failFromInputPump(scope);
          });
        },
        () => {
          void this.serialize(async () => {
            if (
              this.lifecycleState !== CONVERSATION_RUNTIME_STATE.stopped &&
              this.lifecycleState !== CONVERSATION_RUNTIME_STATE.crashed
            ) {
              this.failFromInputPump("observer");
            }
          });
        },
      );
  }

  private failFromInputPump(
    scope: ConversationRuntimeInputPumpFailureScope,
  ): ConversationRuntimeInputPumpError {
    const failure = new ConversationRuntimeInputPumpError(
      this.conversationId,
      this.runtimeInstanceId,
      scope,
    );
    if (
      this.lifecycleState !== CONVERSATION_RUNTIME_STATE.stopped &&
      this.lifecycleState !== CONVERSATION_RUNTIME_STATE.crashed
    ) {
      this.transitionTo(CONVERSATION_RUNTIME_STATE.crashed, "input_pump_failed");
      this.requestInputPumpStop();
      this.completeExit(
        Object.freeze({
          kind: "crashed",
          exitedAt: this.readTimestamp(),
          errorName: failure.name,
          errorCode: failure.code,
        }),
      );
      this.logger.error("runtime.input_pump.failed", { scope });
    }
    return failure;
  }

  private requestInputPumpStop(): void {
    void Promise.resolve()
      .then(() => this.inputPump.stop())
      .catch(() => {
        this.logger.error("runtime.input_pump.stop_failed");
      });
  }

  private stateError(
    operation: (typeof CONVERSATION_RUNTIME_OPERATION)[keyof typeof CONVERSATION_RUNTIME_OPERATION],
  ): ConversationRuntimeStateError {
    return new ConversationRuntimeStateError(
      this.conversationId,
      this.runtimeInstanceId,
      operation,
      this.lifecycleState,
    );
  }

  private readTimestamp(): string {
    try {
      const timestamp = this.clock.now();
      if (isValidTimestamp(timestamp)) return timestamp;
    } catch {}
    return new Date().toISOString();
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const SYSTEM_RUNTIME_CLOCK: ConversationRuntimeClock = Object.freeze({
  now: () => new Date().toISOString(),
});

function captureShutdownReason(
  request: ConversationRuntimeHandleShutdownRequest,
): ConversationRuntimeShutdownReason {
  const reason = request?.reason;
  if (
    typeof reason !== "string" ||
    !Object.values(CONVERSATION_RUNTIME_SHUTDOWN_REASON).some(
      (candidate) => candidate === reason,
    )
  ) {
    throw new TypeError("Conversation Runtime shutdown reason is invalid");
  }
  return reason;
}

function isRecoverableInputFailure(error: unknown): boolean {
  return (
    error instanceof RuntimeInputResolutionError ||
    error instanceof RuntimeInputQueueFullError ||
    error instanceof RuntimeInputConflictError ||
    error instanceof RuntimeInputRejectedError ||
    error instanceof ConversationRuntimeStateError
  );
}

function getSafeErrorIdentity(error: unknown): Readonly<{
  errorName: string;
  errorCode?: string;
}> {
  if (!isKnownSafeRuntimeError(error)) {
    return Object.freeze({ errorName: "UnknownError" });
  }
  return Object.freeze({ errorName: error.name, errorCode: error.code });
}

function isKnownSafeRuntimeError(
  error: unknown,
): error is Error & { readonly code: string } {
  return (
    error instanceof RuntimeBootstrapStartupError ||
    error instanceof RuntimeInputResolutionError ||
    error instanceof RuntimeInputQueueFullError ||
    error instanceof RuntimeInputConflictError ||
    error instanceof RuntimeInputRejectedError ||
    error instanceof ConversationRuntimeStateError ||
    error instanceof ConversationRuntimeStartError ||
    error instanceof ConversationRuntimeDispatchFailureError ||
    error instanceof ConversationRuntimeInputPumpError
  );
}

function captureInputPumpFailureScope(
  exit: Extract<RuntimeInputPumpExit, { kind: "failed" }>,
): ConversationRuntimeInputPumpFailureScope {
  return exit.scope === "control" ||
    exit.scope === "turn" ||
    exit.scope === "scheduler"
    ? exit.scope
    : "observer";
}

function safeSequence(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function assertNonBlank(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}
