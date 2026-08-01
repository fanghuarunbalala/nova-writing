/** Pure Run lifecycle state machine used by the serialized ConversationRuntime. */
import {
  captureDurableInputEventReference,
  type DurableInputEventReference,
} from "../../../event/input/DurableInputEventReference.js";
import {
  isExecutionCancellationReason,
  type ExecutionCancellationReason,
} from "../ExecutionCancellationReason.js";
import {
  isRunStateChangeReason,
  isRunStatus,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  type RunStateChangeReason,
  type RunStatus,
} from "../RunLifecycle.js";
import {
  ExecutionStateRestoreError,
  ExecutionStateTransitionError,
} from "./ExecutionStateErrors.js";

export interface RunStateSnapshot {
  readonly runId: string;
  readonly inputEvent: DurableInputEventReference;
  readonly status: RunStatus;
  readonly reason: RunStateChangeReason;
  readonly transitionOrdinal: number;
  readonly cancellationReason?: ExecutionCancellationReason;
}

export interface RunStateTransition {
  readonly runId: string;
  readonly inputEvent: DurableInputEventReference;
  readonly previous: RunStatus | null;
  readonly current: RunStatus;
  readonly reason: RunStateChangeReason;
  readonly ordinal: number;
  readonly cancellationReason?: ExecutionCancellationReason;
}

export interface BeginRunOptions {
  runId: string;
  inputEvent: DurableInputEventReference;
}

export type RunTransitionRequest =
  | {
      current: "cancelled";
      reason: RunStateChangeReason;
      cancellationReason: ExecutionCancellationReason;
    }
  | {
      current: Exclude<RunStatus, "cancelled">;
      reason: RunStateChangeReason;
      cancellationReason?: never;
    };

export class RunStateMachine {
  private state?: RunStateSnapshot;

  getSnapshot(): RunStateSnapshot | undefined {
    return this.state === undefined ? undefined : captureSnapshot(this.state);
  }

  hasActiveRun(): boolean {
    return this.state !== undefined && !isTerminalRunStatus(this.state.status);
  }

  begin(options: BeginRunOptions): RunStateTransition {
    if (this.hasActiveRun()) {
      throw new ExecutionStateTransitionError(
        "run",
        this.state?.status ?? null,
        RUN_STATUS.queued,
        RUN_STATE_CHANGE_REASON.inputQueued,
      );
    }
    assertNonBlank("Run ID", options.runId);
    const inputEvent = captureDurableInputEventReference(options.inputEvent);
    const transition = captureTransition({
      runId: options.runId,
      inputEvent,
      previous: null,
      current: RUN_STATUS.queued,
      reason: RUN_STATE_CHANGE_REASON.inputQueued,
      ordinal: 0,
    });
    this.state = snapshotFromTransition(transition);
    return transition;
  }

  transition(request: RunTransitionRequest): RunStateTransition {
    const state = this.requireState();
    assertRunRequest(request);
    if (!isAllowedRunTransition(state.status, request.current, request.reason)) {
      throw new ExecutionStateTransitionError(
        "run",
        state.status,
        request.current,
        request.reason,
      );
    }

    const transition = captureTransition({
      runId: state.runId,
      inputEvent: state.inputEvent,
      previous: state.status,
      current: request.current,
      reason: request.reason,
      ordinal: state.transitionOrdinal + 1,
      ...(request.current === RUN_STATUS.cancelled
        ? { cancellationReason: request.cancellationReason }
        : {}),
    });
    this.state = snapshotFromTransition(transition);
    return transition;
  }

  restore(snapshot: RunStateSnapshot): void {
    try {
      assertNonBlank("Run ID", snapshot.runId);
      const captured = captureSnapshot(snapshot);
      assertNonNegativeInteger("Run transition ordinal", captured.transitionOrdinal);
      assertRunStateConsistency(captured.status, captured.cancellationReason);
      if (!isRunStateChangeReason(captured.reason)) {
        throw new TypeError("Run state reason must be registered");
      }
      this.state = captured;
    } catch {
      throw new ExecutionStateRestoreError("run");
    }
  }

  private requireState(): RunStateSnapshot {
    if (this.state === undefined) {
      throw new ExecutionStateTransitionError(
        "run",
        null,
        "unknown",
        "missing_run",
      );
    }
    return this.state;
  }
}

function isAllowedRunTransition(
  previous: RunStatus,
  current: RunStatus,
  reason: RunStateChangeReason,
): boolean {
  return RUN_TRANSITIONS.has(`${previous}>${current}:${reason}`);
}

const RUN_TRANSITIONS = new Set<string>([
  "queued>running:execution_started",
  "queued>stopping:stop_requested",
  "queued>stopping:interrupt_requested",
  "queued>failed:execution_failed",
  "running>waiting_interaction:interaction_requested",
  "waiting_interaction>running:interaction_resolved",
  "running>stopping:stop_requested",
  "running>stopping:interrupt_requested",
  "waiting_interaction>stopping:stop_requested",
  "waiting_interaction>stopping:interrupt_requested",
  "running>completed:execution_completed",
  "running>failed:execution_failed",
  "waiting_interaction>failed:execution_failed",
  "stopping>cancelled:cancellation_completed",
  "stopping>failed:execution_failed",
]);

function assertRunRequest(request: RunTransitionRequest): void {
  if (!isRunStatus(request.current)) {
    throw new TypeError("Run transition status must be registered");
  }
  if (!isRunStateChangeReason(request.reason)) {
    throw new TypeError("Run transition reason must be registered");
  }
  assertRunStateConsistency(request.current, request.cancellationReason);
}

function assertRunStateConsistency(
  status: RunStatus,
  cancellationReason: ExecutionCancellationReason | undefined,
): void {
  if (status === RUN_STATUS.cancelled) {
    if (!isExecutionCancellationReason(cancellationReason)) {
      throw new TypeError("Cancelled Run requires a registered cancellation reason");
    }
    return;
  }
  if (cancellationReason !== undefined) {
    throw new TypeError("Non-cancelled Run must not contain a cancellation reason");
  }
}

function snapshotFromTransition(transition: RunStateTransition): RunStateSnapshot {
  return captureSnapshot({
    runId: transition.runId,
    inputEvent: transition.inputEvent,
    status: transition.current,
    reason: transition.reason,
    transitionOrdinal: transition.ordinal,
    ...(transition.cancellationReason !== undefined
      ? { cancellationReason: transition.cancellationReason }
      : {}),
  });
}

function captureSnapshot(snapshot: RunStateSnapshot): RunStateSnapshot {
  if (!isRunStatus(snapshot.status)) {
    throw new TypeError("Run state status must be registered");
  }
  return Object.freeze({
    runId: snapshot.runId,
    inputEvent: captureDurableInputEventReference(snapshot.inputEvent),
    status: snapshot.status,
    reason: snapshot.reason,
    transitionOrdinal: snapshot.transitionOrdinal,
    ...(snapshot.cancellationReason !== undefined
      ? { cancellationReason: snapshot.cancellationReason }
      : {}),
  });
}

function captureTransition(transition: RunStateTransition): RunStateTransition {
  return Object.freeze({
    runId: transition.runId,
    inputEvent: captureDurableInputEventReference(transition.inputEvent),
    previous: transition.previous,
    current: transition.current,
    reason: transition.reason,
    ordinal: transition.ordinal,
    ...(transition.cancellationReason !== undefined
      ? { cancellationReason: transition.cancellationReason }
      : {}),
  });
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return (
    status === RUN_STATUS.completed ||
    status === RUN_STATUS.failed ||
    status === RUN_STATUS.cancelled
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
