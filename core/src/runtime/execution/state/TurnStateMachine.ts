/** Pure Turn lifecycle state machine scoped to one serialized active Run. */
import {
  isExecutionCancellationReason,
  type ExecutionCancellationReason,
} from "../ExecutionCancellationReason.js";
import {
  isTurnStateChangeReason,
  isTurnStatus,
  TURN_STATE_CHANGE_REASON,
  TURN_STATUS,
  type TurnStateChangeReason,
  type TurnStatus,
} from "../TurnLifecycle.js";
import {
  ExecutionStateRestoreError,
  ExecutionStateTransitionError,
} from "./ExecutionStateErrors.js";

export interface TurnStateSnapshot {
  readonly runId: string;
  readonly turnId: string;
  readonly status: TurnStatus;
  readonly reason: TurnStateChangeReason;
  readonly transitionOrdinal: number;
  readonly cancellationReason?: ExecutionCancellationReason;
}

export interface TurnStateTransition {
  readonly runId: string;
  readonly turnId: string;
  readonly previous: TurnStatus | null;
  readonly current: TurnStatus;
  readonly reason: TurnStateChangeReason;
  readonly ordinal: number;
  readonly cancellationReason?: ExecutionCancellationReason;
}

export interface BeginTurnOptions {
  runId: string;
  turnId: string;
}

export type TurnTransitionRequest =
  | {
      current: "cancelled";
      reason: TurnStateChangeReason;
      cancellationReason: ExecutionCancellationReason;
    }
  | {
      current: Exclude<TurnStatus, "cancelled">;
      reason: TurnStateChangeReason;
      cancellationReason?: never;
    };

export class TurnStateMachine {
  private state?: TurnStateSnapshot;

  getSnapshot(): TurnStateSnapshot | undefined {
    return this.state === undefined ? undefined : captureSnapshot(this.state);
  }

  hasActiveTurn(): boolean {
    return this.state !== undefined && !isTerminalTurnStatus(this.state.status);
  }

  begin(options: BeginTurnOptions): TurnStateTransition {
    if (this.hasActiveTurn()) {
      throw new ExecutionStateTransitionError(
        "turn",
        this.state?.status ?? null,
        TURN_STATUS.running,
        TURN_STATE_CHANGE_REASON.providerStarted,
      );
    }
    assertNonBlank("Run ID", options.runId);
    assertNonBlank("Turn ID", options.turnId);
    const transition = captureTransition({
      runId: options.runId,
      turnId: options.turnId,
      previous: null,
      current: TURN_STATUS.running,
      reason: TURN_STATE_CHANGE_REASON.providerStarted,
      ordinal: 0,
    });
    this.state = snapshotFromTransition(transition);
    return transition;
  }

  transition(request: TurnTransitionRequest): TurnStateTransition {
    const state = this.requireState();
    assertTurnRequest(request);
    if (!isAllowedTurnTransition(state.status, request.current, request.reason)) {
      throw new ExecutionStateTransitionError(
        "turn",
        state.status,
        request.current,
        request.reason,
      );
    }

    const transition = captureTransition({
      runId: state.runId,
      turnId: state.turnId,
      previous: state.status,
      current: request.current,
      reason: request.reason,
      ordinal: state.transitionOrdinal + 1,
      ...(request.current === TURN_STATUS.cancelled
        ? { cancellationReason: request.cancellationReason }
        : {}),
    });
    this.state = snapshotFromTransition(transition);
    return transition;
  }

  restore(snapshot: TurnStateSnapshot): void {
    try {
      assertNonBlank("Run ID", snapshot.runId);
      assertNonBlank("Turn ID", snapshot.turnId);
      const captured = captureSnapshot(snapshot);
      assertNonNegativeInteger("Turn transition ordinal", captured.transitionOrdinal);
      assertTurnStateConsistency(captured.status, captured.cancellationReason);
      if (!isTurnStateChangeReason(captured.reason)) {
        throw new TypeError("Turn state reason must be registered");
      }
      this.state = captured;
    } catch {
      throw new ExecutionStateRestoreError("turn");
    }
  }

  private requireState(): TurnStateSnapshot {
    if (this.state === undefined) {
      throw new ExecutionStateTransitionError(
        "turn",
        null,
        "unknown",
        "missing_turn",
      );
    }
    return this.state;
  }
}

function isAllowedTurnTransition(
  previous: TurnStatus,
  current: TurnStatus,
  reason: TurnStateChangeReason,
): boolean {
  return TURN_TRANSITIONS.has(`${previous}>${current}:${reason}`);
}

const TURN_TRANSITIONS = new Set<string>([
  "running>waiting_tool:tool_execution_started",
  "waiting_tool>running:tool_execution_completed",
  "running>waiting_interaction:interaction_requested",
  "waiting_tool>waiting_interaction:interaction_requested",
  "waiting_interaction>running:interaction_resolved",
  "running>stopping:stop_requested",
  "running>stopping:interrupt_requested",
  "waiting_tool>stopping:stop_requested",
  "waiting_tool>stopping:interrupt_requested",
  "waiting_interaction>stopping:stop_requested",
  "waiting_interaction>stopping:interrupt_requested",
  "running>completed:turn_completed",
  "running>failed:turn_failed",
  "waiting_tool>failed:turn_failed",
  "waiting_interaction>failed:turn_failed",
  "stopping>cancelled:cancellation_completed",
  "stopping>failed:turn_failed",
]);

function assertTurnRequest(request: TurnTransitionRequest): void {
  if (!isTurnStatus(request.current)) {
    throw new TypeError("Turn transition status must be registered");
  }
  if (!isTurnStateChangeReason(request.reason)) {
    throw new TypeError("Turn transition reason must be registered");
  }
  assertTurnStateConsistency(request.current, request.cancellationReason);
}

function assertTurnStateConsistency(
  status: TurnStatus,
  cancellationReason: ExecutionCancellationReason | undefined,
): void {
  if (status === TURN_STATUS.cancelled) {
    if (!isExecutionCancellationReason(cancellationReason)) {
      throw new TypeError("Cancelled Turn requires a registered cancellation reason");
    }
    return;
  }
  if (cancellationReason !== undefined) {
    throw new TypeError("Non-cancelled Turn must not contain a cancellation reason");
  }
}

function snapshotFromTransition(transition: TurnStateTransition): TurnStateSnapshot {
  return captureSnapshot({
    runId: transition.runId,
    turnId: transition.turnId,
    status: transition.current,
    reason: transition.reason,
    transitionOrdinal: transition.ordinal,
    ...(transition.cancellationReason !== undefined
      ? { cancellationReason: transition.cancellationReason }
      : {}),
  });
}

function captureSnapshot(snapshot: TurnStateSnapshot): TurnStateSnapshot {
  if (!isTurnStatus(snapshot.status)) {
    throw new TypeError("Turn state status must be registered");
  }
  return Object.freeze({
    runId: snapshot.runId,
    turnId: snapshot.turnId,
    status: snapshot.status,
    reason: snapshot.reason,
    transitionOrdinal: snapshot.transitionOrdinal,
    ...(snapshot.cancellationReason !== undefined
      ? { cancellationReason: snapshot.cancellationReason }
      : {}),
  });
}

function captureTransition(transition: TurnStateTransition): TurnStateTransition {
  return Object.freeze({
    runId: transition.runId,
    turnId: transition.turnId,
    previous: transition.previous,
    current: transition.current,
    reason: transition.reason,
    ordinal: transition.ordinal,
    ...(transition.cancellationReason !== undefined
      ? { cancellationReason: transition.cancellationReason }
      : {}),
  });
}

function isTerminalTurnStatus(status: TurnStatus): boolean {
  return (
    status === TURN_STATUS.completed ||
    status === TURN_STATUS.failed ||
    status === TURN_STATUS.cancelled
  );
}

function assertNonBlank(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}

function assertNonNegativeInteger(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}
