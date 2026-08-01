/**
 * Applies one durable Stop fence and coordinates persistence-first cancellation.
 *
 * External Provider, Tool, interaction, and child cancellation is delegated to
 * one idempotent port; Core lifecycle and Input outcomes remain owned here.
 */
import {
  canonicalStringifyJson,
  captureDurableInputEventReference,
  INPUT_EVENT_TYPE,
  type DurableInputEventReference,
  type JsonValue,
} from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import { EXECUTION_CANCELLATION_REASON } from "../ExecutionCancellationReason.js";
import { RUN_STATE_CHANGE_REASON, RUN_STATUS, type RunStatus } from "../RunLifecycle.js";
import type { RuntimeInputPumpHandler } from "../input/RuntimeInputPump.js";
import type { RunStateSnapshot, RunTransitionRequest } from "../state/RunStateMachine.js";
import type { TurnStateSnapshot, TurnTransitionRequest } from "../state/TurnStateMachine.js";
import { TURN_STATE_CHANGE_REASON, TURN_STATUS, type TurnStatus } from "../TurnLifecycle.js";
import type {
  LifecycleEventMetadata,
  RunLifecycleCommit,
  TurnLifecycleCommit,
} from "./TurnController.js";
import type {
  RecordRuntimeInputOutcomeOptions,
  RuntimeInputOutcomeCommit,
} from "./RuntimeInputOutcomeController.js";
import {
  RUNTIME_STOP_INPUT_FAILURE,
  RuntimeStopInputHandlerError,
  type RuntimeStopInputFailure,
} from "./RuntimeStopInputHandlerErrors.js";

export interface RuntimeStopFence {
  applyStopFence(stopSequence: number): readonly PersistedInputEventSnapshot[];
}

export interface RuntimeStopLifecycleController {
  getRunSnapshot(): RunStateSnapshot | undefined;
  getTurnSnapshot(): TurnStateSnapshot | undefined;
  transitionRun(
    request: RunTransitionRequest,
    metadata?: LifecycleEventMetadata,
  ): Promise<RunLifecycleCommit>;
  transitionTurn(
    request: TurnTransitionRequest,
    metadata?: LifecycleEventMetadata,
  ): Promise<TurnLifecycleCommit>;
  failRunTerminalWait?(runId: string): void;
}

export interface RuntimeStopOutcomeRecorder {
  record(options: RecordRuntimeInputOutcomeOptions): Promise<RuntimeInputOutcomeCommit>;
}

export interface RuntimeStopCancellationRequest {
  readonly conversationId: string;
  readonly reason: "stop";
  readonly stopInput: DurableInputEventReference;
  readonly runId: string;
  readonly turnId?: string;
}

export interface RuntimeStopCancellationPort {
  cancel(request: RuntimeStopCancellationRequest): Promise<void>;
}

export interface RuntimeStopInputResult {
  readonly stopInput: DurableInputEventReference;
  readonly runId?: string;
  readonly turnId?: string;
  readonly runStatus?: Extract<RunStatus, "cancelled">;
  readonly turnStatus?: Extract<TurnStatus, "cancelled">;
  readonly cancelledInputs: readonly DurableInputEventReference[];
  readonly stopOutcomeReceiptSequence: number;
}

export interface RuntimeStopInputHandlerOptions {
  conversationId: string;
  stopFence: RuntimeStopFence;
  lifecycleController: RuntimeStopLifecycleController;
  outcomeRecorder: RuntimeStopOutcomeRecorder;
  cancellationPort: RuntimeStopCancellationPort;
  logger?: Logger;
}

export class RuntimeStopInputHandler implements RuntimeInputPumpHandler {
  private readonly conversationId: string;
  private readonly stopFence: RuntimeStopFence;
  private readonly lifecycleController: RuntimeStopLifecycleController;
  private readonly outcomeRecorder: RuntimeStopOutcomeRecorder;
  private readonly cancellationPort: RuntimeStopCancellationPort;
  private readonly logger: Logger;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: RuntimeStopInputHandlerOptions) {
    assertNonBlank(options.conversationId);
    this.conversationId = options.conversationId;
    this.stopFence = options.stopFence;
    this.lifecycleController = options.lifecycleController;
    this.outcomeRecorder = options.outcomeRecorder;
    this.cancellationPort = options.cancellationPort;
    this.logger = (options.logger ?? noopLogger).child({
      component: "runtime_stop_input_handler",
      conversationId: this.conversationId,
    });
  }

  async handle(input: PersistedInputEventSnapshot): Promise<void> {
    await this.process(input);
  }

  process(input: PersistedInputEventSnapshot): Promise<RuntimeStopInputResult> {
    let captured: PersistedInputEventSnapshot;
    try {
      captured = captureStopInput(input, this.conversationId);
    } catch {
      return Promise.reject(this.fail(RUNTIME_STOP_INPUT_FAILURE.invalidInput));
    }
    return this.serialize(() => this.processCaptured(captured));
  }

  private async processCaptured(
    input: PersistedInputEventSnapshot,
  ): Promise<RuntimeStopInputResult> {
    const stopInput = captureDurableInputEventReference({
      id: input.id,
      eventType: input.eventType,
      sequence: input.sequence,
    });
    const metadata = captureMetadata(input);
    this.logger.info("runtime.stop.processing_started", toLogIdentity(input));

    let cancelledSnapshots: readonly PersistedInputEventSnapshot[];
    try {
      cancelledSnapshots = captureCancelledSnapshots(
        this.stopFence.applyStopFence(input.sequence),
        this.conversationId,
        input.sequence,
      );
    } catch {
      throw this.fail(RUNTIME_STOP_INPUT_FAILURE.fenceFailed, input);
    }
    this.logger.info("runtime.stop.fence_applied", {
      ...toLogIdentity(input),
      cancelledInputCount: cancelledSnapshots.length,
    });

    let active: ActiveExecution;
    try {
      active = captureActiveExecution(
        this.lifecycleController.getRunSnapshot(),
        this.lifecycleController.getTurnSnapshot(),
      );
    } catch {
      throw this.fail(RUNTIME_STOP_INPUT_FAILURE.lifecycleInvalid, input);
    }
    const cancellationRequest = createCancellationRequest(
      this.conversationId,
      stopInput,
      active,
    );

    if (active.turn !== undefined && active.turn.status !== TURN_STATUS.stopping) {
      try {
        const commit = await this.lifecycleController.transitionTurn(
          {
            current: TURN_STATUS.stopping,
            reason: TURN_STATE_CHANGE_REASON.stopRequested,
          },
          metadata,
        );
        assertTurnCommit(commit, active.turn.turnId, TURN_STATUS.stopping);
      } catch {
        this.requestEmergencyCancellation(cancellationRequest, input);
        throw this.fail(RUNTIME_STOP_INPUT_FAILURE.turnStoppingFailed, input, active);
      }
    }

    if (active.run !== undefined && active.run.status !== RUN_STATUS.stopping) {
      try {
        const commit = await this.lifecycleController.transitionRun(
          {
            current: RUN_STATUS.stopping,
            reason: RUN_STATE_CHANGE_REASON.stopRequested,
          },
          metadata,
        );
        assertRunCommit(commit, active.run.runId, RUN_STATUS.stopping);
      } catch {
        this.requestEmergencyCancellation(cancellationRequest, input);
        throw this.fail(RUNTIME_STOP_INPUT_FAILURE.runStoppingFailed, input, active);
      }
    }

    if (cancellationRequest !== undefined) {
      try {
        await this.cancellationPort.cancel(cancellationRequest);
      } catch {
        this.requestEmergencyCancellation(cancellationRequest, input);
        this.failRunTerminalWait(active);
        throw this.fail(RUNTIME_STOP_INPUT_FAILURE.cancellationFailed, input, active);
      }
      this.logger.info("runtime.stop.cancellation_completed", {
        ...toLogIdentity(input),
        runId: cancellationRequest.runId,
        ...(cancellationRequest.turnId !== undefined
          ? { turnId: cancellationRequest.turnId }
          : {}),
      });
    }

    let turnStatus: "cancelled" | undefined;
    if (active.turn !== undefined) {
      try {
        const turn = this.lifecycleController.getTurnSnapshot();
        if (
          turn?.runId !== active.turn.runId ||
          turn.turnId !== active.turn.turnId ||
          turn.status !== TURN_STATUS.stopping
        ) {
          throw new TypeError("Active Turn is not stopping");
        }
        const commit = await this.lifecycleController.transitionTurn(
          {
            current: TURN_STATUS.cancelled,
            reason: TURN_STATE_CHANGE_REASON.cancellationCompleted,
            cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
          },
          metadata,
        );
        assertTurnCommit(commit, active.turn.turnId, TURN_STATUS.cancelled);
        turnStatus = TURN_STATUS.cancelled;
      } catch {
        this.failRunTerminalWait(active);
        throw this.fail(RUNTIME_STOP_INPUT_FAILURE.turnCancelledFailed, input, active);
      }
    }

    let runStatus: "cancelled" | undefined;
    if (active.run !== undefined) {
      try {
        const run = this.lifecycleController.getRunSnapshot();
        if (run?.runId !== active.run.runId || run.status !== RUN_STATUS.stopping) {
          throw new TypeError("Active Run is not stopping");
        }
        const commit = await this.lifecycleController.transitionRun(
          {
            current: RUN_STATUS.cancelled,
            reason: RUN_STATE_CHANGE_REASON.cancellationCompleted,
            cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
          },
          metadata,
        );
        assertRunCommit(commit, active.run.runId, RUN_STATUS.cancelled);
        runStatus = RUN_STATUS.cancelled;
      } catch {
        this.failRunTerminalWait(active);
        throw this.fail(RUNTIME_STOP_INPUT_FAILURE.runCancelledFailed, input, active);
      }
    }

    const cancelledInputs: DurableInputEventReference[] = [];
    for (const cancelled of cancelledSnapshots) {
      const cancelledInput = captureDurableInputEventReference({
        id: cancelled.id,
        eventType: cancelled.eventType,
        sequence: cancelled.sequence,
      });
      try {
        const commit = await this.outcomeRecorder.record({
          inputEvent: cancelledInput,
          outcome: "cancelled_before_run",
          cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
          ...(cancelled.correlationId !== undefined
            ? { correlationId: cancelled.correlationId }
            : {}),
          causationId: input.id,
        });
        assertCancelledOutcome(commit, cancelledInput);
      } catch {
        throw this.fail(RUNTIME_STOP_INPUT_FAILURE.queuedOutcomeFailed, input, active);
      }
      cancelledInputs.push(cancelledInput);
    }

    let stopOutcome: RuntimeInputOutcomeCommit;
    try {
      stopOutcome = await this.outcomeRecorder.record({
        inputEvent: stopInput,
        outcome: "consumed",
        ...metadata,
        ...(active.run !== undefined ? { runId: active.run.runId } : {}),
        ...(active.turn !== undefined ? { turnId: active.turn.turnId } : {}),
      });
      assertConsumedOutcome(stopOutcome, stopInput);
    } catch {
      throw this.fail(RUNTIME_STOP_INPUT_FAILURE.stopOutcomeFailed, input, active);
    }

    this.logger.info("runtime.stop.processing_completed", {
      ...toLogIdentity(input),
      cancelledInputCount: cancelledInputs.length,
      stopOutcomeSequence: stopOutcome.receipt.sequence,
      ...(active.run !== undefined ? { runId: active.run.runId } : {}),
      ...(active.turn !== undefined ? { turnId: active.turn.turnId } : {}),
    });
    return Object.freeze({
      stopInput,
      ...(active.run !== undefined ? { runId: active.run.runId } : {}),
      ...(active.turn !== undefined ? { turnId: active.turn.turnId } : {}),
      ...(runStatus !== undefined ? { runStatus } : {}),
      ...(turnStatus !== undefined ? { turnStatus } : {}),
      cancelledInputs: Object.freeze(cancelledInputs),
      stopOutcomeReceiptSequence: stopOutcome.receipt.sequence,
    });
  }

  private requestEmergencyCancellation(
    request: RuntimeStopCancellationRequest | undefined,
    input: PersistedInputEventSnapshot,
  ): void {
    if (request === undefined) return;
    void Promise.resolve()
      .then(() => this.cancellationPort.cancel(request))
      .catch(() => {
        this.logger.error("runtime.stop.emergency_cancellation_failed", {
          ...toLogIdentity(input),
          runId: request.runId,
          ...(request.turnId !== undefined ? { turnId: request.turnId } : {}),
        });
      });
  }

  private failRunTerminalWait(active: ActiveExecution): void {
    if (active.run === undefined) return;
    this.lifecycleController.failRunTerminalWait?.(active.run.runId);
  }

  private fail(
    failure: RuntimeStopInputFailure,
    input?: PersistedInputEventSnapshot,
    active?: ActiveExecution,
  ): RuntimeStopInputHandlerError {
    this.logger.error("runtime.stop.processing_failed", {
      failure,
      ...(input !== undefined ? toLogIdentity(input) : {}),
      ...(active?.run !== undefined ? { runId: active.run.runId } : {}),
      ...(active?.turn !== undefined ? { turnId: active.turn.turnId } : {}),
    });
    return new RuntimeStopInputHandlerError(this.conversationId, failure);
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

interface ActiveExecution {
  readonly run?: RunStateSnapshot;
  readonly turn?: TurnStateSnapshot;
}

function captureStopInput(
  input: PersistedInputEventSnapshot,
  conversationId: string,
): PersistedInputEventSnapshot {
  if (
    input === null ||
    typeof input !== "object" ||
    input.direction !== "input" ||
    input.conversationId !== conversationId ||
    input.eventType !== INPUT_EVENT_TYPE.systemStop ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence <= 0
  ) {
    throw new TypeError("Runtime Stop Input is invalid");
  }
  return deepFreezeJson(
    JSON.parse(canonicalStringifyJson(input as unknown as JsonValue)),
  ) as PersistedInputEventSnapshot;
}

function captureCancelledSnapshots(
  inputs: readonly PersistedInputEventSnapshot[],
  conversationId: string,
  stopSequence: number,
): readonly PersistedInputEventSnapshot[] {
  const captured = inputs.map((input) => {
    if (
      input === null ||
      typeof input !== "object" ||
      input.direction !== "input" ||
      input.conversationId !== conversationId ||
      !Number.isSafeInteger(input.sequence) ||
      input.sequence <= 0 ||
      input.sequence > stopSequence ||
      input.eventType === INPUT_EVENT_TYPE.systemStop ||
      input.eventType === INPUT_EVENT_TYPE.reloadConfig
    ) {
      throw new TypeError("Stop fence returned an invalid Turn Input");
    }
    return deepFreezeJson(
      JSON.parse(canonicalStringifyJson(input as unknown as JsonValue)),
    ) as PersistedInputEventSnapshot;
  });
  captured.sort((left, right) => left.sequence - right.sequence);
  const sequences = new Set<number>();
  for (const input of captured) {
    if (sequences.has(input.sequence)) {
      throw new TypeError("Stop fence returned duplicate Input Sequence");
    }
    sequences.add(input.sequence);
  }
  return Object.freeze(captured);
}

function captureActiveExecution(
  run: RunStateSnapshot | undefined,
  turn: TurnStateSnapshot | undefined,
): ActiveExecution {
  const activeRun = run !== undefined && !isTerminalRunStatus(run.status) ? run : undefined;
  const activeTurn =
    turn !== undefined && !isTerminalTurnStatus(turn.status) ? turn : undefined;
  if (
    activeTurn !== undefined &&
    (activeRun === undefined || activeTurn.runId !== activeRun.runId)
  ) {
    throw new TypeError("Active Turn does not belong to an active Run");
  }
  if (
    activeRun?.status === RUN_STATUS.stopping &&
    activeTurn !== undefined &&
    activeTurn.status !== TURN_STATUS.stopping
  ) {
    throw new TypeError("Stopping Run requires a stopping Turn");
  }
  return Object.freeze({
    ...(activeRun !== undefined ? { run: activeRun } : {}),
    ...(activeTurn !== undefined ? { turn: activeTurn } : {}),
  });
}

function createCancellationRequest(
  conversationId: string,
  stopInput: DurableInputEventReference,
  active: ActiveExecution,
): RuntimeStopCancellationRequest | undefined {
  if (active.run === undefined) return undefined;
  return Object.freeze({
    conversationId,
    reason: EXECUTION_CANCELLATION_REASON.stop,
    stopInput,
    runId: active.run.runId,
    ...(active.turn !== undefined ? { turnId: active.turn.turnId } : {}),
  });
}

function captureMetadata(input: PersistedInputEventSnapshot): LifecycleEventMetadata {
  return Object.freeze({
    ...(input.correlationId !== undefined
      ? { correlationId: input.correlationId }
      : {}),
    causationId: input.id,
  });
}

function assertTurnCommit(
  commit: TurnLifecycleCommit,
  turnId: string,
  status: "stopping" | "cancelled",
): void {
  const expectedReason =
    status === TURN_STATUS.stopping
      ? TURN_STATE_CHANGE_REASON.stopRequested
      : TURN_STATE_CHANGE_REASON.cancellationCompleted;
  if (
    commit.scope !== "turn" ||
    commit.transition.turnId !== turnId ||
    commit.transition.current !== status ||
    commit.transition.reason !== expectedReason ||
    (status === TURN_STATUS.cancelled &&
      commit.transition.cancellationReason !== EXECUTION_CANCELLATION_REASON.stop)
  ) {
    throw new TypeError("Turn cancellation commit is invalid");
  }
}

function assertRunCommit(
  commit: RunLifecycleCommit,
  runId: string,
  status: "stopping" | "cancelled",
): void {
  const expectedReason =
    status === RUN_STATUS.stopping
      ? RUN_STATE_CHANGE_REASON.stopRequested
      : RUN_STATE_CHANGE_REASON.cancellationCompleted;
  if (
    commit.scope !== "run" ||
    commit.transition.runId !== runId ||
    commit.transition.current !== status ||
    commit.transition.reason !== expectedReason ||
    (status === RUN_STATUS.cancelled &&
      commit.transition.cancellationReason !== EXECUTION_CANCELLATION_REASON.stop)
  ) {
    throw new TypeError("Run cancellation commit is invalid");
  }
}

function assertCancelledOutcome(
  commit: RuntimeInputOutcomeCommit,
  inputEvent: DurableInputEventReference,
): void {
  if (
    commit.outcome !== "cancelled_before_run" ||
    commit.inputEvent.id !== inputEvent.id ||
    commit.inputEvent.eventType !== inputEvent.eventType ||
    commit.inputEvent.sequence !== inputEvent.sequence ||
    !Number.isSafeInteger(commit.receipt.sequence) ||
    commit.receipt.sequence <= 0
  ) {
    throw new TypeError("Cancelled Input outcome commit is invalid");
  }
}

function assertConsumedOutcome(
  commit: RuntimeInputOutcomeCommit,
  inputEvent: DurableInputEventReference,
): void {
  if (
    commit.outcome !== "consumed" ||
    commit.inputEvent.id !== inputEvent.id ||
    commit.inputEvent.eventType !== inputEvent.eventType ||
    commit.inputEvent.sequence !== inputEvent.sequence ||
    !Number.isSafeInteger(commit.receipt.sequence) ||
    commit.receipt.sequence <= 0
  ) {
    throw new TypeError("Consumed Stop outcome commit is invalid");
  }
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return (
    status === RUN_STATUS.completed ||
    status === RUN_STATUS.failed ||
    status === RUN_STATUS.cancelled
  );
}

function isTerminalTurnStatus(status: TurnStatus): boolean {
  return (
    status === TURN_STATUS.completed ||
    status === TURN_STATUS.failed ||
    status === TURN_STATUS.cancelled
  );
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

function deepFreezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function assertNonBlank(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Conversation ID must not be blank");
  }
}
