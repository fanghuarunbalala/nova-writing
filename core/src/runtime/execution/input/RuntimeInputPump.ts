/**
 * Event-driven two-lane Runtime scheduler with Control preemption.
 *
 * The Pump owns only process-local scheduling. Durable outcomes, Run/Turn
 * transitions, Stop effects, and Provider execution remain handler concerns.
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import type { RuntimeInputInbox } from "./RuntimeInputInbox.js";
import {
  RUNTIME_INPUT_PUMP_OPERATION,
  RuntimeInputPumpFailureError,
  RuntimeInputPumpStateError,
  type RuntimeInputPumpOperation,
} from "./RuntimeInputPumpErrors.js";

export const RUNTIME_INPUT_PUMP_STATE = {
  created: "created",
  running: "running",
  stopping: "stopping",
  stopped: "stopped",
  failed: "failed",
} as const;

export type RuntimeInputPumpState =
  (typeof RUNTIME_INPUT_PUMP_STATE)[keyof typeof RUNTIME_INPUT_PUMP_STATE];

export type RuntimeInputPumpFailureScope = "control" | "turn" | "scheduler";

export interface RuntimeInputPumpClock {
  now(): string;
}

export interface RuntimeInputPumpHandler {
  handle(input: PersistedInputEventSnapshot): Promise<void>;
}

export interface RuntimeInputPumpSource {
  readonly controlInbox: Pick<RuntimeInputInbox, "size" | "dequeue">;
  readonly turnInbox: Pick<RuntimeInputInbox, "size" | "dequeue">;
}

export type RuntimeInputPumpExit =
  | Readonly<{
      kind: "stopped";
      exitedAt: string;
    }>
  | Readonly<{
      kind: "failed";
      exitedAt: string;
      scope: RuntimeInputPumpFailureScope;
      errorName: "RuntimeInputPumpFailureError";
      errorCode: "RUNTIME_INPUT_PUMP_FAILED";
      inputEventId?: string;
      eventType?: string;
      sequence?: number;
    }>;

export interface RuntimeInputPumpSnapshot {
  readonly state: RuntimeInputPumpState;
  readonly controlQueueSize: number;
  readonly turnQueueSize: number;
  readonly controlInFlight?: RuntimeInputPumpInputIdentity;
  readonly turnInFlight?: RuntimeInputPumpInputIdentity;
}

export interface RuntimeInputPumpInputIdentity {
  readonly inputEventId: string;
  readonly eventType: string;
  readonly sequence: number;
}

export interface RuntimeInputPumpOptions {
  conversationId: string;
  source: RuntimeInputPumpSource;
  controlHandler: RuntimeInputPumpHandler;
  turnHandler: RuntimeInputPumpHandler;
  clock?: RuntimeInputPumpClock;
  logger?: Logger;
}

export class RuntimeInputPump {
  private readonly conversationId: string;
  private readonly source: RuntimeInputPumpSource;
  private readonly controlHandler: RuntimeInputPumpHandler;
  private readonly turnHandler: RuntimeInputPumpHandler;
  private readonly clock: RuntimeInputPumpClock;
  private readonly logger: Logger;
  private readonly exitPromise: Promise<RuntimeInputPumpExit>;
  private resolveExit!: (exit: RuntimeInputPumpExit) => void;
  private lifecycleState: RuntimeInputPumpState = RUNTIME_INPUT_PUMP_STATE.created;
  private drainScheduled = false;
  private controlInFlight?: PersistedInputEventSnapshot;
  private turnInFlight?: PersistedInputEventSnapshot;
  private stopPromise?: Promise<void>;
  private resolveStop?: () => void;
  private exit?: RuntimeInputPumpExit;

  constructor(options: RuntimeInputPumpOptions) {
    assertNonBlank(options.conversationId);
    this.conversationId = options.conversationId;
    this.source = options.source;
    this.controlHandler = options.controlHandler;
    this.turnHandler = options.turnHandler;
    this.clock = options.clock ?? SYSTEM_RUNTIME_INPUT_PUMP_CLOCK;
    this.logger = (options.logger ?? noopLogger).child({
      component: "runtime_input_pump",
      conversationId: this.conversationId,
    });
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  get state(): RuntimeInputPumpState {
    return this.lifecycleState;
  }

  getSnapshot(): RuntimeInputPumpSnapshot {
    return Object.freeze({
      state: this.lifecycleState,
      controlQueueSize: this.source.controlInbox.size,
      turnQueueSize: this.source.turnInbox.size,
      ...(this.controlInFlight !== undefined
        ? { controlInFlight: captureIdentity(this.controlInFlight) }
        : {}),
      ...(this.turnInFlight !== undefined
        ? { turnInFlight: captureIdentity(this.turnInFlight) }
        : {}),
    });
  }

  start(): void {
    if (this.lifecycleState !== RUNTIME_INPUT_PUMP_STATE.created) {
      throw this.stateError(RUNTIME_INPUT_PUMP_OPERATION.start);
    }
    this.transitionTo(RUNTIME_INPUT_PUMP_STATE.running, "start_requested");
    this.logger.info("runtime.input_pump.started", {
      controlQueueSize: this.source.controlInbox.size,
      turnQueueSize: this.source.turnInbox.size,
    });
    this.scheduleDrain();
  }

  wake(): void {
    if (this.lifecycleState !== RUNTIME_INPUT_PUMP_STATE.running) {
      throw this.stateError(RUNTIME_INPUT_PUMP_OPERATION.wake);
    }
    this.logger.debug("runtime.input_pump.woken", {
      controlQueueSize: this.source.controlInbox.size,
      turnQueueSize: this.source.turnInbox.size,
      controlActive: this.controlInFlight !== undefined,
      turnActive: this.turnInFlight !== undefined,
    });
    this.scheduleDrain();
  }

  stop(): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise;
    if (
      this.lifecycleState === RUNTIME_INPUT_PUMP_STATE.stopped ||
      this.lifecycleState === RUNTIME_INPUT_PUMP_STATE.failed
    ) {
      this.stopPromise = Promise.resolve();
      return this.stopPromise;
    }

    this.stopPromise = new Promise((resolve) => {
      this.resolveStop = resolve;
    });
    this.transitionTo(RUNTIME_INPUT_PUMP_STATE.stopping, "stop_requested");
    this.logger.info("runtime.input_pump.stop_started", {
      controlActive: this.controlInFlight !== undefined,
      turnActive: this.turnInFlight !== undefined,
      controlQueueSize: this.source.controlInbox.size,
      turnQueueSize: this.source.turnInbox.size,
    });
    this.completeStopIfIdle();
    return this.stopPromise;
  }

  waitForExit(): Promise<RuntimeInputPumpExit> {
    return this.exitPromise;
  }

  private scheduleDrain(): void {
    if (
      this.lifecycleState !== RUNTIME_INPUT_PUMP_STATE.running ||
      this.drainScheduled
    ) {
      return;
    }
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      try {
        this.drain();
      } catch {
        this.fail(RUNTIME_INPUT_PUMP_FAILURE_SCOPE.scheduler);
      }
    });
  }

  private drain(): void {
    if (this.lifecycleState !== RUNTIME_INPUT_PUMP_STATE.running) return;

    if (this.controlInFlight === undefined) {
      const control = this.source.controlInbox.dequeue();
      if (control !== undefined) this.startControl(control);
    }

    if (
      this.turnInFlight === undefined &&
      this.controlInFlight === undefined &&
      this.source.controlInbox.size === 0
    ) {
      const turn = this.source.turnInbox.dequeue();
      if (turn !== undefined) this.startTurn(turn);
    }
  }

  private startControl(input: PersistedInputEventSnapshot): void {
    this.controlInFlight = input;
    this.logger.info("runtime.input_pump.control_started", toLogIdentity(input));
    void this.executeHandler(
      RUNTIME_INPUT_PUMP_FAILURE_SCOPE.control,
      input,
      this.controlHandler,
    );
  }

  private startTurn(input: PersistedInputEventSnapshot): void {
    this.turnInFlight = input;
    this.logger.info("runtime.input_pump.turn_started", toLogIdentity(input));
    void this.executeHandler(
      RUNTIME_INPUT_PUMP_FAILURE_SCOPE.turn,
      input,
      this.turnHandler,
    );
  }

  private async executeHandler(
    scope: "control" | "turn",
    input: PersistedInputEventSnapshot,
    handler: RuntimeInputPumpHandler,
  ): Promise<void> {
    try {
      await handler.handle(input);
      this.completeHandler(scope, input);
    } catch {
      this.fail(scope, input);
    }
  }

  private completeHandler(
    scope: "control" | "turn",
    input: PersistedInputEventSnapshot,
  ): void {
    if (scope === RUNTIME_INPUT_PUMP_FAILURE_SCOPE.control) {
      if (this.controlInFlight === input) this.controlInFlight = undefined;
    } else if (this.turnInFlight === input) {
      this.turnInFlight = undefined;
    }
    this.logger.info(`runtime.input_pump.${scope}_completed`, toLogIdentity(input));
    if (this.lifecycleState === RUNTIME_INPUT_PUMP_STATE.running) {
      this.scheduleDrain();
    } else {
      this.completeStopIfIdle();
    }
  }

  private fail(
    scope: RuntimeInputPumpFailureScope,
    input?: PersistedInputEventSnapshot,
  ): void {
    if (
      this.lifecycleState === RUNTIME_INPUT_PUMP_STATE.failed ||
      this.lifecycleState === RUNTIME_INPUT_PUMP_STATE.stopped
    ) {
      return;
    }
    if (scope === RUNTIME_INPUT_PUMP_FAILURE_SCOPE.control) {
      this.controlInFlight = undefined;
    } else if (scope === RUNTIME_INPUT_PUMP_FAILURE_SCOPE.turn) {
      this.turnInFlight = undefined;
    }
    const failure = new RuntimeInputPumpFailureError(this.conversationId, scope);
    this.transitionTo(RUNTIME_INPUT_PUMP_STATE.failed, "handler_failed");
    const exit: RuntimeInputPumpExit = Object.freeze({
      kind: "failed",
      exitedAt: this.readTimestamp(),
      scope,
      errorName: failure.name,
      errorCode: failure.code,
      ...(input !== undefined ? toExitIdentity(input) : {}),
    });
    this.completeExit(exit);
    this.resolveStop?.();
    this.logger.error("runtime.input_pump.failed", {
      scope,
      ...(input !== undefined ? toLogIdentity(input) : {}),
    });
  }

  private completeStopIfIdle(): void {
    if (
      this.lifecycleState !== RUNTIME_INPUT_PUMP_STATE.stopping ||
      this.controlInFlight !== undefined ||
      this.turnInFlight !== undefined
    ) {
      return;
    }
    this.transitionTo(RUNTIME_INPUT_PUMP_STATE.stopped, "stop_completed");
    this.completeExit(
      Object.freeze({ kind: "stopped", exitedAt: this.readTimestamp() }),
    );
    this.resolveStop?.();
    this.logger.info("runtime.input_pump.stop_completed", {
      controlQueueSize: this.source.controlInbox.size,
      turnQueueSize: this.source.turnInbox.size,
    });
  }

  private completeExit(exit: RuntimeInputPumpExit): void {
    if (this.exit !== undefined) return;
    this.exit = exit;
    this.resolveExit(exit);
  }

  private transitionTo(state: RuntimeInputPumpState, reason: string): void {
    const previousState = this.lifecycleState;
    this.lifecycleState = state;
    this.logger.info("runtime.input_pump.state_changed", {
      previousState,
      state,
      reason,
    });
  }

  private stateError(operation: RuntimeInputPumpOperation): RuntimeInputPumpStateError {
    return new RuntimeInputPumpStateError(
      this.conversationId,
      operation,
      this.lifecycleState,
    );
  }

  private readTimestamp(): string {
    try {
      const value = this.clock.now();
      if (isValidTimestamp(value)) return value;
    } catch {}
    return new Date().toISOString();
  }
}

const RUNTIME_INPUT_PUMP_FAILURE_SCOPE = {
  control: "control",
  turn: "turn",
  scheduler: "scheduler",
} as const;

const SYSTEM_RUNTIME_INPUT_PUMP_CLOCK: RuntimeInputPumpClock = Object.freeze({
  now: () => new Date().toISOString(),
});

function captureIdentity(
  input: PersistedInputEventSnapshot,
): RuntimeInputPumpInputIdentity {
  return Object.freeze({
    inputEventId: input.id,
    eventType: input.eventType,
    sequence: input.sequence,
  });
}

function toLogIdentity(input: PersistedInputEventSnapshot): Readonly<{
  inputEventId: string;
  eventType: string;
  sequence: number;
}> {
  return {
    inputEventId: input.id,
    eventType: input.eventType,
    sequence: input.sequence,
  };
}

function toExitIdentity(input: PersistedInputEventSnapshot): Readonly<{
  inputEventId: string;
  eventType: string;
  sequence: number;
}> {
  return Object.freeze(toLogIdentity(input));
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function assertNonBlank(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Conversation ID must not be blank");
  }
}
