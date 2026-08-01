/** Persistence-first coordinator for Core Run and Turn lifecycle transitions. */
import type { DurableInputEventReference } from "../../../event/input/DurableInputEventReference.js";
import {
  AgentRunStateChangedOutputEvent,
  AgentTurnStateChangedOutputEvent,
  OUTPUT_EVENT_TYPE,
  type OutputEvent,
} from "../../../event/output/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { RunTransitionRequest } from "../state/RunStateMachine.js";
import {
  RunStateMachine,
  type RunStateSnapshot,
  type RunStateTransition,
} from "../state/RunStateMachine.js";
import type { TurnTransitionRequest } from "../state/TurnStateMachine.js";
import {
  TurnStateMachine,
  type TurnStateSnapshot,
  type TurnStateTransition,
} from "../state/TurnStateMachine.js";
import { RUN_STATUS } from "../RunLifecycle.js";
import { TURN_STATUS } from "../TurnLifecycle.js";
import type { RuntimeEventIdFactory } from "../event/RuntimeEventIdFactory.js";
import type {
  RuntimeEventAppendReceipt,
  RuntimeEventSink,
} from "../event/RuntimeEventSink.js";
import {
  RandomRunIdGenerator,
  RandomTurnIdGenerator,
  type RunIdGenerator,
  type TurnIdGenerator,
} from "./ExecutionIdentityGenerator.js";
import {
  TurnControllerPendingCommitError,
  TurnControllerStateError,
} from "./TurnControllerErrors.js";

export interface TurnControllerClock {
  now(): string;
}

export class SystemTurnControllerClock implements TurnControllerClock {
  now(): string {
    return new Date().toISOString();
  }
}

export interface LifecycleEventMetadata {
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface BeginControlledRunOptions extends LifecycleEventMetadata {
  readonly inputEvent: DurableInputEventReference;
  readonly runId?: string;
}

export interface BeginControlledTurnOptions extends LifecycleEventMetadata {
  readonly turnId?: string;
}

export type RunLifecycleCommit = Readonly<{
  scope: "run";
  transition: RunStateTransition;
  receipt: RuntimeEventAppendReceipt;
}>;

export type TurnLifecycleCommit = Readonly<{
  scope: "turn";
  transition: TurnStateTransition;
  receipt: RuntimeEventAppendReceipt;
}>;

export type LifecycleCommit = RunLifecycleCommit | TurnLifecycleCommit;

export interface PendingLifecycleCommitSnapshot {
  readonly scope: "run" | "turn";
  readonly eventId: string;
  readonly eventType: string;
  readonly ordinal: number;
}

export interface TurnControllerRestoreOptions {
  readonly run?: RunStateSnapshot;
  readonly turn?: TurnStateSnapshot;
}

export interface TurnControllerOptions {
  conversationId: string;
  eventIdFactory: RuntimeEventIdFactory;
  eventSink: RuntimeEventSink;
  runIdGenerator?: RunIdGenerator;
  turnIdGenerator?: TurnIdGenerator;
  clock?: TurnControllerClock;
  logger?: Logger;
}

type PendingCommit =
  | {
      scope: "run";
      event: AgentRunStateChangedOutputEvent;
      transition: RunStateTransition;
      next: RunStateSnapshot;
    }
  | {
      scope: "turn";
      event: AgentTurnStateChangedOutputEvent;
      transition: TurnStateTransition;
      next: TurnStateSnapshot;
    };

interface RunTerminalWaiter {
  readonly runId: string;
  readonly resolve: (snapshot: RunStateSnapshot) => void;
  readonly reject: (error: TurnControllerStateError) => void;
}

export class TurnController {
  private readonly conversationId: string;
  private readonly eventIdFactory: RuntimeEventIdFactory;
  private readonly eventSink: RuntimeEventSink;
  private readonly runIdGenerator: RunIdGenerator;
  private readonly turnIdGenerator: TurnIdGenerator;
  private readonly clock: TurnControllerClock;
  private readonly logger: Logger;
  private readonly runState = new RunStateMachine();
  private readonly turnState = new TurnStateMachine();
  private tail: Promise<void> = Promise.resolve();
  private pending?: PendingCommit;
  private readonly runTerminalWaiters: RunTerminalWaiter[] = [];
  private failedRunTerminalWaitId?: string;

  constructor(options: TurnControllerOptions) {
    assertNonBlank("Conversation ID", options.conversationId);
    this.conversationId = options.conversationId;
    this.eventIdFactory = options.eventIdFactory;
    this.eventSink = options.eventSink;
    this.runIdGenerator = options.runIdGenerator ?? new RandomRunIdGenerator();
    this.turnIdGenerator = options.turnIdGenerator ?? new RandomTurnIdGenerator();
    this.clock = options.clock ?? new SystemTurnControllerClock();
    this.logger = (options.logger ?? noopLogger).child({
      component: "turn_controller",
      conversationId: this.conversationId,
    });
  }

  getRunSnapshot(): RunStateSnapshot | undefined {
    return this.runState.getSnapshot();
  }

  getTurnSnapshot(): TurnStateSnapshot | undefined {
    return this.turnState.getSnapshot();
  }

  waitForRunTerminal(runId: string): Promise<RunStateSnapshot> {
    assertNonBlank("Run ID", runId);
    const snapshot = this.runState.getSnapshot();
    if (snapshot?.runId !== runId) {
      return Promise.reject(
        new TurnControllerStateError("run_terminal_wait_mismatch"),
      );
    }
    if (isTerminalRun(snapshot.status)) return Promise.resolve(snapshot);
    if (this.failedRunTerminalWaitId === runId) {
      return Promise.reject(
        new TurnControllerStateError("run_terminal_wait_failed"),
      );
    }
    this.logger.debug("turn_controller.run_terminal_wait_started", {
      runId,
      runStatus: snapshot.status,
    });
    return new Promise<RunStateSnapshot>((resolve, reject) => {
      this.runTerminalWaiters.push({ runId, resolve, reject });
    });
  }

  failRunTerminalWait(runId: string): void {
    assertNonBlank("Run ID", runId);
    const snapshot = this.runState.getSnapshot();
    if (snapshot?.runId !== runId || isTerminalRun(snapshot.status)) return;
    if (this.failedRunTerminalWaitId === runId) return;
    this.failedRunTerminalWaitId = runId;
    const failure = new TurnControllerStateError("run_terminal_wait_failed");
    const rejected = this.rejectRunTerminalWaiters(runId, failure);
    this.logger.error("turn_controller.run_terminal_wait_failed", {
      runId,
      runStatus: snapshot.status,
      waiterCount: rejected,
    });
  }

  getPendingCommit(): PendingLifecycleCommitSnapshot | undefined {
    if (this.pending === undefined) return undefined;
    return Object.freeze({
      scope: this.pending.scope,
      eventId: this.pending.event.id,
      eventType: this.pending.event.getEventType(),
      ordinal: this.pending.transition.ordinal,
    });
  }

  beginRun(options: BeginControlledRunOptions): Promise<RunLifecycleCommit> {
    return this.serialize(async () => {
      this.assertNoPending();
      const machine = cloneRunMachine(this.runState.getSnapshot());
      const transition = machine.begin({
        runId: options.runId ?? this.runIdGenerator.generate(),
        inputEvent: options.inputEvent,
      });
      this.failedRunTerminalWaitId = undefined;
      const event = this.createRunEvent(transition, {
        ...options,
        causationId: options.causationId ?? options.inputEvent.id,
      });
      return this.commitRun(event, transition, requireRunSnapshot(machine));
    });
  }

  transitionRun(
    request: RunTransitionRequest,
    metadata: LifecycleEventMetadata = {},
  ): Promise<RunLifecycleCommit> {
    return this.serialize(async () => {
      this.assertNoPending();
      this.assertRunTransitionCoordination(request);
      const machine = cloneRunMachine(this.runState.getSnapshot());
      const transition = machine.transition(request);
      return this.commitRun(
        this.createRunEvent(transition, metadata),
        transition,
        requireRunSnapshot(machine),
      );
    });
  }

  beginTurn(options: BeginControlledTurnOptions = {}): Promise<TurnLifecycleCommit> {
    return this.serialize(async () => {
      this.assertNoPending();
      const run = this.runState.getSnapshot();
      if (run?.status !== RUN_STATUS.running) {
        throw new TurnControllerStateError("run_not_running");
      }
      const machine = cloneTurnMachine(this.turnState.getSnapshot());
      const transition = machine.begin({
        runId: run.runId,
        turnId: options.turnId ?? this.turnIdGenerator.generate(),
      });
      return this.commitTurn(
        this.createTurnEvent(transition, options),
        transition,
        requireTurnSnapshot(machine),
      );
    });
  }

  transitionTurn(
    request: TurnTransitionRequest,
    metadata: LifecycleEventMetadata = {},
  ): Promise<TurnLifecycleCommit> {
    return this.serialize(async () => {
      this.assertNoPending();
      const run = this.runState.getSnapshot();
      if (run === undefined || isTerminalRun(run.status)) {
        throw new TurnControllerStateError("run_not_active");
      }
      const machine = cloneTurnMachine(this.turnState.getSnapshot());
      const transition = machine.transition(request);
      return this.commitTurn(
        this.createTurnEvent(transition, metadata),
        transition,
        requireTurnSnapshot(machine),
      );
    });
  }

  retryPending(): Promise<LifecycleCommit> {
    return this.serialize(async () => {
      if (this.pending === undefined) throw new TurnControllerStateError("no_pending_commit");
      return this.flushPending(this.pending);
    });
  }

  restore(options: TurnControllerRestoreOptions): Promise<void> {
    return this.serialize(async () => {
      this.assertNoPending();
      if (this.runState.getSnapshot() !== undefined || this.turnState.getSnapshot() !== undefined) {
        throw new TurnControllerStateError("restore_requires_fresh_controller");
      }
      const runMachine = cloneRunMachine(options.run);
      const turnMachine = cloneTurnMachine(options.turn);
      assertRestoredCoordination(runMachine.getSnapshot(), turnMachine.getSnapshot());
      if (options.run !== undefined) this.runState.restore(options.run);
      if (options.turn !== undefined) this.turnState.restore(options.turn);
    });
  }

  private async commitRun(
    event: AgentRunStateChangedOutputEvent,
    transition: RunStateTransition,
    next: RunStateSnapshot,
  ): Promise<RunLifecycleCommit> {
    const pending: PendingCommit = { scope: "run", event, transition, next };
    this.pending = pending;
    const commit = await this.flushPending(pending);
    if (commit.scope !== "run") throw new TurnControllerStateError("run_commit_scope_mismatch");
    return commit;
  }

  private async commitTurn(
    event: AgentTurnStateChangedOutputEvent,
    transition: TurnStateTransition,
    next: TurnStateSnapshot,
  ): Promise<TurnLifecycleCommit> {
    const pending: PendingCommit = { scope: "turn", event, transition, next };
    this.pending = pending;
    const commit = await this.flushPending(pending);
    if (commit.scope !== "turn") throw new TurnControllerStateError("turn_commit_scope_mismatch");
    return commit;
  }

  private async flushPending(pending: PendingCommit): Promise<LifecycleCommit> {
    this.logger.debug("turn_controller.commit_started", {
      scope: pending.scope,
      eventId: pending.event.id,
      eventType: pending.event.getEventType(),
      ordinal: pending.transition.ordinal,
    });
    let receipt: RuntimeEventAppendReceipt;
    try {
      receipt = await this.eventSink.append(pending.event);
    } catch (error) {
      if (pending.scope === "run" && isTerminalRun(pending.next.status)) {
        this.failRunTerminalWait(pending.next.runId);
      }
      throw error;
    }
    if (pending.scope === "run") this.runState.restore(pending.next);
    else this.turnState.restore(pending.next);
    if (this.pending === pending) this.pending = undefined;
    this.logger.info("turn_controller.commit_completed", {
      scope: pending.scope,
      eventId: pending.event.id,
      eventType: pending.event.getEventType(),
      ordinal: pending.transition.ordinal,
      sequence: receipt.sequence,
      status: receipt.status,
    });
    if (pending.scope === "run" && isTerminalRun(pending.next.status)) {
      this.resolveRunTerminalWaiters(pending.next);
    }
    return Object.freeze({
      scope: pending.scope,
      transition: pending.transition,
      receipt,
    }) as LifecycleCommit;
  }

  private createRunEvent(
    transition: RunStateTransition,
    metadata: LifecycleEventMetadata,
  ): AgentRunStateChangedOutputEvent {
    return new AgentRunStateChangedOutputEvent({
      conversationId: this.conversationId,
      id: this.eventIdFactory.create({
        conversationId: this.conversationId,
        eventType: OUTPUT_EVENT_TYPE.agentRunStateChanged,
        scope: "run",
        runId: transition.runId,
        ordinal: transition.ordinal,
      }),
      timestamp: this.clock.now(),
      runId: transition.runId,
      inputEvent: transition.inputEvent,
      previous: transition.previous,
      current: transition.current,
      reason: transition.reason,
      ...(transition.cancellationReason !== undefined
        ? { cancellationReason: transition.cancellationReason }
        : {}),
      ...(metadata.correlationId !== undefined
        ? { correlationId: metadata.correlationId }
        : {}),
      ...(metadata.causationId !== undefined ? { causationId: metadata.causationId } : {}),
    } as ConstructorParameters<typeof AgentRunStateChangedOutputEvent>[0]);
  }

  private createTurnEvent(
    transition: TurnStateTransition,
    metadata: LifecycleEventMetadata,
  ): AgentTurnStateChangedOutputEvent {
    return new AgentTurnStateChangedOutputEvent({
      conversationId: this.conversationId,
      id: this.eventIdFactory.create({
        conversationId: this.conversationId,
        eventType: OUTPUT_EVENT_TYPE.agentTurnStateChanged,
        scope: "turn",
        runId: transition.runId,
        turnId: transition.turnId,
        ordinal: transition.ordinal,
      }),
      timestamp: this.clock.now(),
      runId: transition.runId,
      turnId: transition.turnId,
      previous: transition.previous,
      current: transition.current,
      reason: transition.reason,
      ...(transition.cancellationReason !== undefined
        ? { cancellationReason: transition.cancellationReason }
        : {}),
      ...(metadata.correlationId !== undefined
        ? { correlationId: metadata.correlationId }
        : {}),
      ...(metadata.causationId !== undefined ? { causationId: metadata.causationId } : {}),
    } as ConstructorParameters<typeof AgentTurnStateChangedOutputEvent>[0]);
  }

  private assertRunTransitionCoordination(request: RunTransitionRequest): void {
    const turn = this.turnState.getSnapshot();
    if (turn === undefined || isTerminalTurn(turn.status)) return;
    if (request.current === RUN_STATUS.stopping && turn.status === TURN_STATUS.stopping) return;
    throw new TurnControllerStateError("active_turn_blocks_run_transition");
  }

  private assertNoPending(): void {
    if (this.pending !== undefined) throw new TurnControllerPendingCommitError();
  }

  private resolveRunTerminalWaiters(snapshot: RunStateSnapshot): void {
    this.failedRunTerminalWaitId = undefined;
    let resolved = 0;
    for (let index = this.runTerminalWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.runTerminalWaiters[index];
      if (waiter?.runId !== snapshot.runId) continue;
      this.runTerminalWaiters.splice(index, 1);
      waiter.resolve(snapshot);
      resolved += 1;
    }
    this.logger.debug("turn_controller.run_terminal_wait_completed", {
      runId: snapshot.runId,
      runStatus: snapshot.status,
      waiterCount: resolved,
    });
  }

  private rejectRunTerminalWaiters(
    runId: string,
    error: TurnControllerStateError,
  ): number {
    let rejected = 0;
    for (let index = this.runTerminalWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.runTerminalWaiters[index];
      if (waiter?.runId !== runId) continue;
      this.runTerminalWaiters.splice(index, 1);
      waiter.reject(error);
      rejected += 1;
    }
    return rejected;
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

function cloneRunMachine(snapshot: RunStateSnapshot | undefined): RunStateMachine {
  const machine = new RunStateMachine();
  if (snapshot !== undefined) machine.restore(snapshot);
  return machine;
}

function cloneTurnMachine(snapshot: TurnStateSnapshot | undefined): TurnStateMachine {
  const machine = new TurnStateMachine();
  if (snapshot !== undefined) machine.restore(snapshot);
  return machine;
}

function requireRunSnapshot(machine: RunStateMachine): RunStateSnapshot {
  const snapshot = machine.getSnapshot();
  if (snapshot === undefined) throw new TurnControllerStateError("run_snapshot_missing");
  return snapshot;
}

function requireTurnSnapshot(machine: TurnStateMachine): TurnStateSnapshot {
  const snapshot = machine.getSnapshot();
  if (snapshot === undefined) throw new TurnControllerStateError("turn_snapshot_missing");
  return snapshot;
}

function assertRestoredCoordination(
  run: RunStateSnapshot | undefined,
  turn: TurnStateSnapshot | undefined,
): void {
  if (turn === undefined) return;
  if (run === undefined || turn.runId !== run.runId) {
    throw new TurnControllerStateError("restored_turn_run_mismatch");
  }
  if (!isTerminalTurn(turn.status) && isTerminalRun(run.status)) {
    throw new TurnControllerStateError("active_turn_with_terminal_run");
  }
}

function isTerminalRun(status: string): boolean {
  return status === RUN_STATUS.completed || status === RUN_STATUS.failed || status === RUN_STATUS.cancelled;
}

function isTerminalTurn(status: string): boolean {
  return status === TURN_STATUS.completed || status === TURN_STATUS.failed || status === TURN_STATUS.cancelled;
}

function assertNonBlank(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}
