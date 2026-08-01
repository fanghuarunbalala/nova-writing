/** Executes a ready startup plan in repair, restore, then route order. */
import {
  canonicalStringifyJson,
  type JsonValue,
} from "../../../event/protocol/index.js";
import { captureDurableInputEventReference } from "../../../event/input/DurableInputEventReference.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import type {
  RuntimeInputOutcomeCommit,
  RuntimeInputOutcomeController,
} from "../control/RuntimeInputOutcomeController.js";
import type { TurnController } from "../control/TurnController.js";
import type {
  InputRouter,
  RuntimeInputRouteResult,
} from "../input/InputRouter.js";
import { RuntimeInputQueueFullError } from "../input/RuntimeInputErrors.js";
import { RUN_STATUS } from "../RunLifecycle.js";
import { RunStateMachine } from "../state/RunStateMachine.js";
import { TurnStateMachine } from "../state/TurnStateMachine.js";
import { TURN_STATUS } from "../TurnLifecycle.js";
import {
  RUNTIME_STARTUP_LIFECYCLE_DISPOSITION,
  type RuntimeStartupOutcomeRepair,
  type RuntimeStartupPlan,
} from "./RuntimeStartupReconciler.js";
import {
  RUNTIME_STARTUP_EXECUTION_FAILURE,
  RuntimeStartupExecutionError,
  type RuntimeStartupExecutionFailure,
} from "./RuntimeStartupExecutionError.js";

export const RUNTIME_STARTUP_EXECUTION_STATUS = {
  idle: "idle",
  repairing: "repairing",
  repairBlocked: "repair_blocked",
  restoring: "restoring",
  routing: "routing",
  routeBlocked: "route_blocked",
  completed: "completed",
  failed: "failed",
} as const;

export type RuntimeStartupExecutionStatus =
  (typeof RUNTIME_STARTUP_EXECUTION_STATUS)[keyof typeof RUNTIME_STARTUP_EXECUTION_STATUS];

export interface RuntimeStartupExecutionSnapshot {
  readonly status: RuntimeStartupExecutionStatus;
  readonly throughSequence?: number;
  readonly completedRepairCount: number;
  readonly totalRepairCount: number;
  readonly completedRouteCount: number;
  readonly totalRouteCount: number;
  readonly nextRepairInputEventId?: string;
  readonly nextRouteSequence?: number;
}

export interface RuntimeStartupExecutionResult {
  readonly conversationId: string;
  readonly throughSequence: number;
  readonly repairCommits: readonly RuntimeInputOutcomeCommit[];
  readonly routeResults: readonly RuntimeInputRouteResult[];
}

export interface RuntimeStartupExecutorOptions {
  conversationId: string;
  outcomeController: RuntimeInputOutcomeController;
  turnController: TurnController;
  inputRouter: InputRouter;
  logger?: Logger;
}

interface ActiveExecution {
  readonly plan: RuntimeStartupPlan;
  readonly repairCommits: RuntimeInputOutcomeCommit[];
  readonly routeResults: RuntimeInputRouteResult[];
  repairIndex: number;
  routeIndex: number;
  restored: boolean;
  status: RuntimeStartupExecutionStatus;
  result?: RuntimeStartupExecutionResult;
}

export class RuntimeStartupExecutor {
  private readonly conversationId: string;
  private readonly outcomeController: RuntimeInputOutcomeController;
  private readonly turnController: TurnController;
  private readonly inputRouter: InputRouter;
  private readonly logger: Logger;
  private tail: Promise<void> = Promise.resolve();
  private active?: ActiveExecution;

  constructor(options: RuntimeStartupExecutorOptions) {
    assertNonBlank(options.conversationId);
    this.conversationId = options.conversationId;
    this.outcomeController = options.outcomeController;
    this.turnController = options.turnController;
    this.inputRouter = options.inputRouter;
    this.logger = (options.logger ?? noopLogger).child({
      component: "runtime_startup_executor",
      conversationId: this.conversationId,
    });
  }

  getSnapshot(): RuntimeStartupExecutionSnapshot {
    const active = this.active;
    if (active === undefined) {
      return Object.freeze({
        status: RUNTIME_STARTUP_EXECUTION_STATUS.idle,
        completedRepairCount: 0,
        totalRepairCount: 0,
        completedRouteCount: 0,
        totalRouteCount: 0,
      });
    }
    const nextRepair = active.plan.outcomeRepairs[active.repairIndex];
    const nextRoute = active.plan.routableInputs[active.routeIndex];
    return Object.freeze({
      status: active.status,
      throughSequence: active.plan.throughSequence,
      completedRepairCount: active.repairIndex,
      totalRepairCount: active.plan.outcomeRepairs.length,
      completedRouteCount: active.routeIndex,
      totalRouteCount: active.plan.routableInputs.length,
      ...(nextRepair !== undefined
        ? { nextRepairInputEventId: nextRepair.inputEvent.id }
        : {}),
      ...(nextRoute !== undefined ? { nextRouteSequence: nextRoute.sequence } : {}),
    });
  }

  execute(plan: RuntimeStartupPlan): Promise<RuntimeStartupExecutionResult> {
    return this.serialize(async () => {
      if (this.active !== undefined) {
        throw this.error(
          this.active.plan.throughSequence,
          RUNTIME_STARTUP_EXECUTION_FAILURE.alreadyStarted,
        );
      }
      let capturedPlan: RuntimeStartupPlan;
      try {
        capturedPlan = capturePlan(plan, this.conversationId);
      } catch {
        throw this.error(
          Number.isSafeInteger(plan?.throughSequence) ? plan.throughSequence : 0,
          RUNTIME_STARTUP_EXECUTION_FAILURE.invalidPlan,
        );
      }
      if (
        capturedPlan.lifecycleDisposition !==
        RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.ready
      ) {
        throw this.error(
          capturedPlan.throughSequence,
          RUNTIME_STARTUP_EXECUTION_FAILURE.recoveryRequired,
        );
      }
      this.active = {
        plan: capturedPlan,
        repairCommits: [],
        routeResults: [],
        repairIndex: 0,
        routeIndex: 0,
        restored: false,
        status: RUNTIME_STARTUP_EXECUTION_STATUS.repairing,
      };
      this.logger.info("runtime.startup.execution_started", {
        throughSequence: capturedPlan.throughSequence,
        outcomeRepairCount: capturedPlan.outcomeRepairs.length,
        routableInputCount: capturedPlan.routableInputs.length,
      });
      return this.advance(this.active);
    });
  }

  resume(): Promise<RuntimeStartupExecutionResult> {
    return this.serialize(async () => {
      const active = this.active;
      if (
        active === undefined ||
        (active.status !== RUNTIME_STARTUP_EXECUTION_STATUS.repairBlocked &&
          active.status !== RUNTIME_STARTUP_EXECUTION_STATUS.routeBlocked)
      ) {
        throw this.error(
          active?.plan.throughSequence ?? 0,
          RUNTIME_STARTUP_EXECUTION_FAILURE.noResumableExecution,
        );
      }

      if (active.status === RUNTIME_STARTUP_EXECUTION_STATUS.repairBlocked) {
        const repair = active.plan.outcomeRepairs[active.repairIndex];
        const pending = this.outcomeController.getPendingCommit();
        if (repair === undefined || pending?.inputEvent.id !== repair.inputEvent.id) {
          active.status = RUNTIME_STARTUP_EXECUTION_STATUS.failed;
          throw this.error(
            active.plan.throughSequence,
            RUNTIME_STARTUP_EXECUTION_FAILURE.outcomeFailed,
          );
        }
        try {
          const commit = await this.outcomeController.retryPending();
          active.repairCommits.push(commit);
          active.repairIndex += 1;
          active.status = RUNTIME_STARTUP_EXECUTION_STATUS.repairing;
        } catch {
          throw this.error(
            active.plan.throughSequence,
            RUNTIME_STARTUP_EXECUTION_FAILURE.outcomePending,
          );
        }
      } else {
        active.status = RUNTIME_STARTUP_EXECUTION_STATUS.routing;
      }
      return this.advance(active);
    });
  }

  private async advance(active: ActiveExecution): Promise<RuntimeStartupExecutionResult> {
    while (active.repairIndex < active.plan.outcomeRepairs.length) {
      active.status = RUNTIME_STARTUP_EXECUTION_STATUS.repairing;
      const repair = active.plan.outcomeRepairs[active.repairIndex];
      if (repair === undefined) {
        active.status = RUNTIME_STARTUP_EXECUTION_STATUS.failed;
        throw this.error(
          active.plan.throughSequence,
          RUNTIME_STARTUP_EXECUTION_FAILURE.invalidPlan,
        );
      }
      try {
        const commit = await this.outcomeController.record({
          inputEvent: repair.inputEvent,
          outcome: repair.outcome,
          runId: repair.runId,
          ...(repair.correlationId !== undefined
            ? { correlationId: repair.correlationId }
            : {}),
        });
        active.repairCommits.push(commit);
        active.repairIndex += 1;
      } catch {
        const pending = this.outcomeController.getPendingCommit();
        if (pending?.inputEvent.id === repair.inputEvent.id) {
          active.status = RUNTIME_STARTUP_EXECUTION_STATUS.repairBlocked;
          this.logger.warn("runtime.startup.outcome_repair_blocked", {
            throughSequence: active.plan.throughSequence,
            inputEventId: repair.inputEvent.id,
            inputEventType: repair.inputEvent.eventType,
            inputSequence: repair.inputEvent.sequence,
            completedRepairCount: active.repairIndex,
          });
          throw this.error(
            active.plan.throughSequence,
            RUNTIME_STARTUP_EXECUTION_FAILURE.outcomePending,
          );
        }
        active.status = RUNTIME_STARTUP_EXECUTION_STATUS.failed;
        throw this.error(
          active.plan.throughSequence,
          RUNTIME_STARTUP_EXECUTION_FAILURE.outcomeFailed,
        );
      }
    }

    if (!active.restored) {
      active.status = RUNTIME_STARTUP_EXECUTION_STATUS.restoring;
      try {
        await this.turnController.restore({
          ...(active.plan.run !== undefined ? { run: active.plan.run } : {}),
          ...(active.plan.turn !== undefined ? { turn: active.plan.turn } : {}),
        });
        active.restored = true;
      } catch {
        active.status = RUNTIME_STARTUP_EXECUTION_STATUS.failed;
        throw this.error(
          active.plan.throughSequence,
          RUNTIME_STARTUP_EXECUTION_FAILURE.restoreFailed,
        );
      }
    }

    active.status = RUNTIME_STARTUP_EXECUTION_STATUS.routing;
    while (active.routeIndex < active.plan.routableInputs.length) {
      const input = active.plan.routableInputs[active.routeIndex];
      if (input === undefined) {
        active.status = RUNTIME_STARTUP_EXECUTION_STATUS.failed;
        throw this.error(
          active.plan.throughSequence,
          RUNTIME_STARTUP_EXECUTION_FAILURE.invalidPlan,
        );
      }
      try {
        const result = this.inputRouter.route(input);
        active.routeResults.push(result);
        active.routeIndex += 1;
      } catch (error) {
        if (error instanceof RuntimeInputQueueFullError) {
          active.status = RUNTIME_STARTUP_EXECUTION_STATUS.routeBlocked;
          this.logger.warn("runtime.startup.route_blocked", {
            throughSequence: active.plan.throughSequence,
            inputEventId: input.id,
            inputEventType: input.eventType,
            inputSequence: input.sequence,
            lane: error.lane,
            capacity: error.capacity,
            completedRouteCount: active.routeIndex,
          });
          throw this.error(
            active.plan.throughSequence,
            RUNTIME_STARTUP_EXECUTION_FAILURE.routeBlocked,
          );
        }
        active.status = RUNTIME_STARTUP_EXECUTION_STATUS.failed;
        throw this.error(
          active.plan.throughSequence,
          RUNTIME_STARTUP_EXECUTION_FAILURE.routeFailed,
        );
      }
    }

    active.status = RUNTIME_STARTUP_EXECUTION_STATUS.completed;
    active.result = Object.freeze({
      conversationId: this.conversationId,
      throughSequence: active.plan.throughSequence,
      repairCommits: Object.freeze([...active.repairCommits]),
      routeResults: Object.freeze([...active.routeResults]),
    });
    this.logger.info("runtime.startup.execution_completed", {
      throughSequence: active.plan.throughSequence,
      outcomeRepairCount: active.result.repairCommits.length,
      routedInputCount: active.result.routeResults.length,
    });
    return active.result;
  }

  private error(
    throughSequence: number,
    failure: RuntimeStartupExecutionFailure,
  ): RuntimeStartupExecutionError {
    this.logger.error("runtime.startup.execution_failed", {
      throughSequence,
      failure,
    });
    return new RuntimeStartupExecutionError(
      this.conversationId,
      throughSequence,
      failure,
    );
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

function capturePlan(plan: RuntimeStartupPlan, conversationId: string): RuntimeStartupPlan {
  if (
    plan === null ||
    typeof plan !== "object" ||
    plan.conversationId !== conversationId ||
    !Number.isSafeInteger(plan.throughSequence) ||
    plan.throughSequence < 0 ||
    (plan.lifecycleDisposition !== RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.ready &&
      plan.lifecycleDisposition !==
        RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.recoveryRequired) ||
    !Array.isArray(plan.outcomeRepairs) ||
    !Array.isArray(plan.routableInputs)
  ) {
    throw new RuntimeStartupExecutionError(
      conversationId,
      Number.isSafeInteger(plan?.throughSequence) ? plan.throughSequence : 0,
      RUNTIME_STARTUP_EXECUTION_FAILURE.invalidPlan,
    );
  }
  const outcomeRepairs = captureRepairs(plan, plan.throughSequence);
  const routableInputs = captureRoutableInputs(
    plan,
    conversationId,
    plan.throughSequence,
  );
  const repairIds = new Set(outcomeRepairs.map((repair) => repair.inputEvent.id));
  if (routableInputs.some((input) => repairIds.has(input.id))) {
    throw new TypeError("Startup repair and route inputs overlap");
  }
  const lifecycle = captureLifecycle(plan);
  return Object.freeze({
    conversationId,
    throughSequence: plan.throughSequence,
    lifecycleDisposition: plan.lifecycleDisposition,
    outcomeRepairs: Object.freeze(outcomeRepairs),
    routableInputs: Object.freeze(routableInputs),
    ...(lifecycle.run !== undefined ? { run: lifecycle.run } : {}),
    ...(lifecycle.turn !== undefined ? { turn: lifecycle.turn } : {}),
  });
}

function captureRepairs(
  plan: RuntimeStartupPlan,
  throughSequence: number,
): RuntimeStartupOutcomeRepair[] {
  const repairs: RuntimeStartupOutcomeRepair[] = [];
  const ids = new Set<string>();
  let previousSequence = 0;
  for (const repair of plan.outcomeRepairs) {
    const inputEvent = captureDurableInputEventReference(repair.inputEvent);
    if (
      repair.outcome !== "consumed" ||
      typeof repair.runId !== "string" ||
      repair.runId.trim().length === 0 ||
      (repair.correlationId !== undefined &&
        (typeof repair.correlationId !== "string" ||
          repair.correlationId.trim().length === 0)) ||
      inputEvent.sequence <= previousSequence ||
      inputEvent.sequence > throughSequence ||
      ids.has(inputEvent.id)
    ) {
      throw new TypeError("Startup outcome repair is invalid");
    }
    previousSequence = inputEvent.sequence;
    ids.add(inputEvent.id);
    repairs.push(
      Object.freeze({
        inputEvent,
        outcome: repair.outcome,
        runId: repair.runId,
        ...(repair.correlationId !== undefined
          ? { correlationId: repair.correlationId }
          : {}),
      }),
    );
  }
  return repairs;
}

function captureRoutableInputs(
  plan: RuntimeStartupPlan,
  conversationId: string,
  throughSequence: number,
): PersistedInputEventSnapshot[] {
  const inputs: PersistedInputEventSnapshot[] = [];
  const ids = new Set<string>();
  let previousSequence = 0;
  for (const candidate of plan.routableInputs) {
    const input = captureJson(candidate) as PersistedInputEventSnapshot;
    if (
      input.direction !== "input" ||
      input.conversationId !== conversationId ||
      typeof input.id !== "string" ||
      input.id.trim().length === 0 ||
      !Number.isSafeInteger(input.sequence) ||
      input.sequence <= previousSequence ||
      input.sequence > throughSequence ||
      ids.has(input.id)
    ) {
      throw new TypeError("Startup routable Input is invalid");
    }
    previousSequence = input.sequence;
    ids.add(input.id);
    inputs.push(input);
  }
  return inputs;
}

function captureLifecycle(plan: RuntimeStartupPlan): Readonly<{
  run?: RuntimeStartupPlan["run"];
  turn?: RuntimeStartupPlan["turn"];
}> {
  if (plan.run === undefined) {
    if (plan.turn !== undefined) throw new TypeError("Startup Turn requires Run");
    return Object.freeze({});
  }
  const runMachine = new RunStateMachine();
  const turnMachine = new TurnStateMachine();
  runMachine.restore(plan.run);
  if (plan.turn !== undefined) turnMachine.restore(plan.turn);
  const run = runMachine.getSnapshot();
  const turn = turnMachine.getSnapshot();
  if (
    run === undefined ||
    (turn !== undefined &&
      (turn.runId !== run.runId || (isTerminalRun(run.status) && !isTerminalTurn(turn.status))))
  ) {
    throw new TypeError("Startup lifecycle is invalid");
  }
  if (
    plan.lifecycleDisposition === RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.ready &&
    !isTerminalRun(run.status)
  ) {
    throw new TypeError("Ready startup cannot contain active Run");
  }
  return Object.freeze({ run, ...(turn !== undefined ? { turn } : {}) });
}

function captureJson<T>(value: T): T {
  return deepFreezeJson(
    JSON.parse(canonicalStringifyJson(value as unknown as JsonValue)),
  ) as T;
}

function deepFreezeJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}

function isTerminalRun(status: string): boolean {
  return (
    status === RUN_STATUS.completed ||
    status === RUN_STATUS.failed ||
    status === RUN_STATUS.cancelled
  );
}

function isTerminalTurn(status: string): boolean {
  return (
    status === TURN_STATUS.completed ||
    status === TURN_STATUS.failed ||
    status === TURN_STATUS.cancelled
  );
}

function assertNonBlank(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RuntimeStartupExecutionError(
      "unknown",
      0,
      RUNTIME_STARTUP_EXECUTION_FAILURE.invalidPlan,
    );
  }
}
