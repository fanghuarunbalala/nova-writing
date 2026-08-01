/** Derives ordered startup repairs and routing without mutating Runtime state. */
import {
  captureDurableInputEventReference,
  type DurableInputEventReference,
} from "../../../event/input/DurableInputEventReference.js";
import { RUNTIME_INPUT_PROCESSING_OUTCOME } from "../../../event/output/payload/RuntimeInputProcessedPayload.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import { RUN_STATUS, type RunStatus } from "../RunLifecycle.js";
import type { RuntimeReplayPlan } from "../source/RuntimeReplayPlanner.js";
import {
  RunStateMachine,
  type RunStateSnapshot,
} from "../state/RunStateMachine.js";
import {
  TurnStateMachine,
  type TurnStateSnapshot,
} from "../state/TurnStateMachine.js";
import { TURN_STATUS, type TurnStatus } from "../TurnLifecycle.js";
import {
  RUNTIME_STARTUP_RECONCILIATION_FAILURE,
  RuntimeStartupReconciliationError,
  type RuntimeStartupReconciliationFailure,
} from "./RuntimeStartupReconciliationError.js";

export const RUNTIME_STARTUP_LIFECYCLE_DISPOSITION = {
  ready: "ready",
  recoveryRequired: "recovery_required",
} as const;

export type RuntimeStartupLifecycleDisposition =
  (typeof RUNTIME_STARTUP_LIFECYCLE_DISPOSITION)[keyof typeof RUNTIME_STARTUP_LIFECYCLE_DISPOSITION];

export interface RuntimeStartupOutcomeRepair {
  readonly inputEvent: DurableInputEventReference;
  readonly outcome: typeof RUNTIME_INPUT_PROCESSING_OUTCOME.consumed;
  readonly runId: string;
  readonly correlationId?: string;
}

export interface RuntimeStartupPlan {
  readonly conversationId: string;
  readonly throughSequence: number;
  readonly lifecycleDisposition: RuntimeStartupLifecycleDisposition;
  readonly outcomeRepairs: readonly RuntimeStartupOutcomeRepair[];
  readonly routableInputs: readonly PersistedInputEventSnapshot[];
  readonly run?: RunStateSnapshot;
  readonly turn?: TurnStateSnapshot;
}

export interface RuntimeStartupReconcilerOptions {
  logger?: Logger;
}

export class RuntimeStartupReconciler {
  private readonly logger: Logger;

  constructor(options: RuntimeStartupReconcilerOptions = {}) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "runtime_startup_reconciler",
    });
  }

  reconcile(replay: RuntimeReplayPlan): RuntimeStartupPlan {
    let identity: StartupPlanIdentity;
    try {
      identity = capturePlanIdentity(replay);
    } catch (error) {
      if (error instanceof RuntimeStartupReconciliationError) this.logFailure(error);
      throw error;
    }
    try {
      const pendingInputs = capturePendingInputs(replay, identity);
      const outcomeRepairs = captureOutcomeRepairs(replay, pendingInputs, identity);
      const repairIds = new Set(outcomeRepairs.map((repair) => repair.inputEvent.id));
      const routableInputs = pendingInputs.filter((input) => !repairIds.has(input.id));
      const lifecycle = captureLifecycle(replay, identity);
      const plan = captureStartupPlan({
        conversationId: identity.conversationId,
        throughSequence: identity.throughSequence,
        lifecycleDisposition: lifecycle.disposition,
        outcomeRepairs,
        routableInputs,
        run: lifecycle.run,
        turn: lifecycle.turn,
      });
      this.logger.info("runtime.startup.reconciled", {
        conversationId: plan.conversationId,
        throughSequence: plan.throughSequence,
        lifecycleDisposition: plan.lifecycleDisposition,
        outcomeRepairCount: plan.outcomeRepairs.length,
        routableInputCount: plan.routableInputs.length,
        ...(plan.run !== undefined
          ? { runId: plan.run.runId, runStatus: plan.run.status }
          : {}),
        ...(plan.turn !== undefined
          ? { turnId: plan.turn.turnId, turnStatus: plan.turn.status }
          : {}),
      });
      return plan;
    } catch (error) {
      if (error instanceof RuntimeStartupReconciliationError) {
        this.logFailure(error);
        throw error;
      }
      const normalized = new RuntimeStartupReconciliationError(
        identity.conversationId,
        identity.throughSequence,
        RUNTIME_STARTUP_RECONCILIATION_FAILURE.invalidPlan,
      );
      this.logFailure(normalized);
      throw normalized;
    }
  }

  private logFailure(error: RuntimeStartupReconciliationError): void {
    this.logger.error("runtime.startup.reconcile_failed", {
      conversationId: error.conversationId,
      throughSequence: error.throughSequence,
      failure: error.failure,
    });
  }
}

interface StartupPlanIdentity {
  readonly conversationId: string;
  readonly throughSequence: number;
}

function capturePlanIdentity(replay: RuntimeReplayPlan): StartupPlanIdentity {
  if (
    replay === null ||
    typeof replay !== "object" ||
    typeof replay.conversationId !== "string" ||
    replay.conversationId.trim().length === 0 ||
    !Number.isSafeInteger(replay.throughSequence) ||
    replay.throughSequence < 0
  ) {
    throw new RuntimeStartupReconciliationError(
      safeIdentifier(replay?.conversationId),
      Number.isSafeInteger(replay?.throughSequence) ? replay.throughSequence : 0,
      RUNTIME_STARTUP_RECONCILIATION_FAILURE.invalidPlan,
    );
  }
  return Object.freeze({
    conversationId: replay.conversationId,
    throughSequence: replay.throughSequence,
  });
}

function capturePendingInputs(
  replay: RuntimeReplayPlan,
  identity: StartupPlanIdentity,
): PersistedInputEventSnapshot[] {
  if (!Array.isArray(replay.pendingInputs)) {
    throw failure(identity, RUNTIME_STARTUP_RECONCILIATION_FAILURE.invalidPlan);
  }
  const inputs: PersistedInputEventSnapshot[] = [];
  const inputIds = new Set<string>();
  let previousSequence = 0;
  for (const input of replay.pendingInputs) {
    if (
      input === null ||
      typeof input !== "object" ||
      input.direction !== "input" ||
      input.conversationId !== identity.conversationId ||
      typeof input.id !== "string" ||
      input.id.trim().length === 0 ||
      !Number.isSafeInteger(input.sequence) ||
      input.sequence <= previousSequence ||
      input.sequence > identity.throughSequence ||
      inputIds.has(input.id)
    ) {
      throw failure(identity, RUNTIME_STARTUP_RECONCILIATION_FAILURE.invalidPlan);
    }
    previousSequence = input.sequence;
    inputIds.add(input.id);
    inputs.push(input);
  }
  return inputs;
}

function captureOutcomeRepairs(
  replay: RuntimeReplayPlan,
  pendingInputs: readonly PersistedInputEventSnapshot[],
  identity: StartupPlanIdentity,
): RuntimeStartupOutcomeRepair[] {
  if (!Array.isArray(replay.unconfirmedRunInputs)) {
    throw failure(identity, RUNTIME_STARTUP_RECONCILIATION_FAILURE.invalidPlan);
  }
  const pendingById = new Map(pendingInputs.map((input) => [input.id, input]));
  const claimsById = new Map<
    string,
    Readonly<{ inputEvent: DurableInputEventReference; runId: string }>
  >();
  for (const claim of replay.unconfirmedRunInputs) {
    if (
      claim === null ||
      typeof claim !== "object" ||
      typeof claim.runId !== "string" ||
      claim.runId.trim().length === 0 ||
      claimsById.has(claim.inputEvent?.id)
    ) {
      throw failure(identity, RUNTIME_STARTUP_RECONCILIATION_FAILURE.claimMismatch);
    }
    let inputEvent: DurableInputEventReference;
    try {
      inputEvent = captureDurableInputEventReference(claim.inputEvent);
    } catch {
      throw failure(identity, RUNTIME_STARTUP_RECONCILIATION_FAILURE.claimMismatch);
    }
    const pending = pendingById.get(inputEvent.id);
    if (
      pending === undefined ||
      pending.eventType !== inputEvent.eventType ||
      pending.sequence !== inputEvent.sequence
    ) {
      throw failure(identity, RUNTIME_STARTUP_RECONCILIATION_FAILURE.claimMismatch);
    }
    claimsById.set(inputEvent.id, Object.freeze({ inputEvent, runId: claim.runId }));
  }

  const repairs: RuntimeStartupOutcomeRepair[] = [];
  for (const pending of pendingInputs) {
    const claim = claimsById.get(pending.id);
    if (claim === undefined) continue;
    repairs.push(
      Object.freeze({
        inputEvent: claim.inputEvent,
        outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.consumed,
        runId: claim.runId,
        ...(pending.correlationId !== undefined
          ? { correlationId: pending.correlationId }
          : {}),
      }),
    );
  }
  if (repairs.length !== claimsById.size) {
    throw failure(identity, RUNTIME_STARTUP_RECONCILIATION_FAILURE.claimMismatch);
  }
  return repairs;
}

function captureLifecycle(
  replay: RuntimeReplayPlan,
  identity: StartupPlanIdentity,
): Readonly<{
  disposition: RuntimeStartupLifecycleDisposition;
  run?: RunStateSnapshot;
  turn?: TurnStateSnapshot;
}> {
  if (replay.run === undefined) {
    if (replay.turn !== undefined) {
      throw failure(identity, RUNTIME_STARTUP_RECONCILIATION_FAILURE.lifecycleConflict);
    }
    return Object.freeze({
      disposition: RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.ready,
    });
  }

  const runMachine = new RunStateMachine();
  const turnMachine = new TurnStateMachine();
  try {
    runMachine.restore(replay.run);
    if (replay.turn !== undefined) turnMachine.restore(replay.turn);
  } catch {
    throw failure(identity, RUNTIME_STARTUP_RECONCILIATION_FAILURE.lifecycleConflict);
  }
  const run = runMachine.getSnapshot();
  const turn = turnMachine.getSnapshot();
  if (run === undefined) {
    throw failure(identity, RUNTIME_STARTUP_RECONCILIATION_FAILURE.lifecycleConflict);
  }
  if (turn !== undefined) {
    if (
      turn.runId !== run.runId ||
      (isTerminalRun(run.status) && !isTerminalTurn(turn.status))
    ) {
      throw failure(identity, RUNTIME_STARTUP_RECONCILIATION_FAILURE.lifecycleConflict);
    }
  }
  return Object.freeze({
    disposition: isTerminalRun(run.status)
      ? RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.ready
      : RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.recoveryRequired,
    run,
    ...(turn !== undefined ? { turn } : {}),
  });
}

function captureStartupPlan(options: {
  conversationId: string;
  throughSequence: number;
  lifecycleDisposition: RuntimeStartupLifecycleDisposition;
  outcomeRepairs: RuntimeStartupOutcomeRepair[];
  routableInputs: PersistedInputEventSnapshot[];
  run: RunStateSnapshot | undefined;
  turn: TurnStateSnapshot | undefined;
}): RuntimeStartupPlan {
  return Object.freeze({
    conversationId: options.conversationId,
    throughSequence: options.throughSequence,
    lifecycleDisposition: options.lifecycleDisposition,
    outcomeRepairs: Object.freeze([...options.outcomeRepairs]),
    routableInputs: Object.freeze([...options.routableInputs]),
    ...(options.run !== undefined ? { run: options.run } : {}),
    ...(options.turn !== undefined ? { turn: options.turn } : {}),
  });
}

function failure(
  identity: StartupPlanIdentity,
  reason: RuntimeStartupReconciliationFailure,
): RuntimeStartupReconciliationError {
  return new RuntimeStartupReconciliationError(
    identity.conversationId,
    identity.throughSequence,
    reason,
  );
}

function isTerminalRun(status: RunStatus): boolean {
  return (
    status === RUN_STATUS.completed ||
    status === RUN_STATUS.failed ||
    status === RUN_STATUS.cancelled
  );
}

function isTerminalTurn(status: TurnStatus): boolean {
  return (
    status === TURN_STATUS.completed ||
    status === TURN_STATUS.failed ||
    status === TURN_STATUS.cancelled
  );
}

function safeIdentifier(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value : "unknown";
}
