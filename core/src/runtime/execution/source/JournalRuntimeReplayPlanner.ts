/** Reconstructs pending Inputs and lifecycle state from one fixed Journal range. */
import {
  canonicalStringifyJson,
  OUTPUT_EVENT_TYPE,
  type DurableInputEventReference,
  type EventSchemaRegistry,
  type InputEventSnapshot,
  type JsonValue,
  type OutputEventSnapshot,
} from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { ConversationJournalReader } from "../../../storage/journal/ConversationJournalStore.js";
import type {
  PersistedConversationEventSnapshot,
  PersistedInputEventSnapshot,
  PersistedOutputEventSnapshot,
} from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import type { ExecutionCancellationReason } from "../ExecutionCancellationReason.js";
import type { RuntimeEventIdFactory } from "../event/RuntimeEventIdFactory.js";
import {
  RUN_STATUS,
  type RunStateChangeReason,
  type RunStatus,
} from "../RunLifecycle.js";
import {
  RunStateMachine,
  type RunStateSnapshot,
  type RunStateTransition,
  type RunTransitionRequest,
} from "../state/RunStateMachine.js";
import {
  TurnStateMachine,
  type TurnStateSnapshot,
  type TurnStateTransition,
  type TurnTransitionRequest,
} from "../state/TurnStateMachine.js";
import {
  TURN_STATUS,
  type TurnStateChangeReason,
  type TurnStatus,
} from "../TurnLifecycle.js";
import {
  RUNTIME_REPLAY_PLANNING_FAILURE,
  RuntimeReplayPlanningError,
  type RuntimeReplayPlanningFailure,
} from "./RuntimeReplayPlanningError.js";
import type {
  RuntimeReplayPlan,
  RuntimeReplayPlanner,
  RuntimeReplayRequest,
} from "./RuntimeReplayPlanner.js";

export const DEFAULT_RUNTIME_REPLAY_PAGE_SIZE = 200;
export const MAX_RUNTIME_REPLAY_PAGE_SIZE = 1_000;

export interface JournalRuntimeReplayPlannerOptions {
  journal: ConversationJournalReader;
  eventSchemaRegistry: EventSchemaRegistry;
  eventIdFactory: RuntimeEventIdFactory;
  pageSize?: number;
  logger?: Logger;
}

export class JournalRuntimeReplayPlanner implements RuntimeReplayPlanner {
  readonly pageSize: number;

  private readonly journal: ConversationJournalReader;
  private readonly eventSchemaRegistry: EventSchemaRegistry;
  private readonly eventIdFactory: RuntimeEventIdFactory;
  private readonly logger: Logger;

  constructor(options: JournalRuntimeReplayPlannerOptions) {
    this.journal = options.journal;
    this.eventSchemaRegistry = options.eventSchemaRegistry;
    this.eventIdFactory = options.eventIdFactory;
    this.pageSize = capturePageSize(
      options.pageSize ?? DEFAULT_RUNTIME_REPLAY_PAGE_SIZE,
    );
    this.logger = (options.logger ?? noopLogger).child({
      component: "journal_runtime_replay_planner",
      pageSize: this.pageSize,
    });
  }

  async plan(request: RuntimeReplayRequest): Promise<RuntimeReplayPlan> {
    let capturedRequest: RuntimeReplayRequest;
    try {
      capturedRequest = captureRequest(request);
    } catch (error) {
      if (error instanceof RuntimeReplayPlanningError) this.logFailure(error);
      throw error;
    }

    const state = createReplayState();
    let cursor = 0;
    while (cursor < capturedRequest.throughSequence) {
      this.logger.debug("runtime.replay.page_started", {
        conversationId: capturedRequest.conversationId,
        afterSequence: cursor,
        throughSequence: capturedRequest.throughSequence,
      });
      let page;
      try {
        page = await this.journal.list({
          conversationId: capturedRequest.conversationId,
          anchor: { afterSequence: cursor },
          throughSequence: capturedRequest.throughSequence,
          limit: this.pageSize,
        });
      } catch {
        throw this.fail(
          capturedRequest,
          cursor,
          RUNTIME_REPLAY_PLANNING_FAILURE.readFailed,
        );
      }

      const events = this.capturePage(capturedRequest, cursor, page);
      for (const event of events) this.applyEvent(capturedRequest, state, event);
      cursor = events.at(-1)?.sequence ?? cursor;
      this.logger.debug("runtime.replay.page_completed", {
        conversationId: capturedRequest.conversationId,
        throughSequence: capturedRequest.throughSequence,
        cursor,
        eventCount: events.length,
      });
    }

    const pendingInputs = [...state.inputs.values()].filter(
      (input) => !state.processedInputIds.has(input.id),
    );
    const plan = capturePlan({
      conversationId: capturedRequest.conversationId,
      throughSequence: capturedRequest.throughSequence,
      scannedEventCount: state.scannedEventCount,
      processedInputCount: state.processedInputIds.size,
      pendingInputs,
      run: state.runState.getSnapshot(),
      turn: state.turnState.getSnapshot(),
    });
    this.logger.info("runtime.replay.planned", {
      conversationId: plan.conversationId,
      throughSequence: plan.throughSequence,
      scannedEventCount: plan.scannedEventCount,
      processedInputCount: plan.processedInputCount,
      pendingInputCount: plan.pendingInputs.length,
      ...(plan.run !== undefined
        ? { runId: plan.run.runId, runStatus: plan.run.status }
        : {}),
      ...(plan.turn !== undefined
        ? { turnId: plan.turn.turnId, turnStatus: plan.turn.status }
        : {}),
    });
    return plan;
  }

  private capturePage(
    request: RuntimeReplayRequest,
    cursor: number,
    page: Awaited<ReturnType<ConversationJournalReader["list"]>>,
  ): readonly PersistedConversationEventSnapshot[] {
    if (
      !Number.isSafeInteger(page.highWatermark) ||
      page.highWatermark !== request.throughSequence ||
      typeof page.hasNext !== "boolean"
    ) {
      throw this.fail(
        request,
        cursor,
        RUNTIME_REPLAY_PLANNING_FAILURE.watermarkMismatch,
      );
    }
    if (!Array.isArray(page.events) || page.events.length === 0) {
      throw this.fail(request, cursor + 1, RUNTIME_REPLAY_PLANNING_FAILURE.journalGap);
    }
    if (page.events.length > this.pageSize) {
      throw this.fail(request, cursor, RUNTIME_REPLAY_PLANNING_FAILURE.historyConflict);
    }

    let expectedSequence = cursor + 1;
    for (const event of page.events) {
      if (
        event === null ||
        typeof event !== "object" ||
        event.conversationId !== request.conversationId ||
        event.sequence !== expectedSequence ||
        event.sequence > request.throughSequence
      ) {
        throw this.fail(
          request,
          expectedSequence,
          RUNTIME_REPLAY_PLANNING_FAILURE.journalGap,
        );
      }
      expectedSequence += 1;
    }

    const lastSequence = page.events.at(-1)?.sequence;
    if (lastSequence === undefined) {
      throw this.fail(request, cursor + 1, RUNTIME_REPLAY_PLANNING_FAILURE.journalGap);
    }
    if (
      (lastSequence < request.throughSequence && !page.hasNext) ||
      (lastSequence === request.throughSequence && page.hasNext)
    ) {
      throw this.fail(
        request,
        lastSequence,
        RUNTIME_REPLAY_PLANNING_FAILURE.watermarkMismatch,
      );
    }
    return page.events;
  }

  private applyEvent(
    request: RuntimeReplayRequest,
    state: ReplayState,
    event: PersistedConversationEventSnapshot,
  ): void {
    state.scannedEventCount += 1;
    if (event.direction === "input") {
      let captured: PersistedInputEventSnapshot;
      try {
        this.eventSchemaRegistry.validateInput(toInputSnapshot(event));
        captured = captureJson(event) as PersistedInputEventSnapshot;
      } catch {
        throw this.fail(request, event.sequence, RUNTIME_REPLAY_PLANNING_FAILURE.invalidEvent);
      }
      if (state.inputs.has(captured.id)) {
        throw this.fail(
          request,
          event.sequence,
          RUNTIME_REPLAY_PLANNING_FAILURE.historyConflict,
        );
      }
      state.inputs.set(captured.id, captured);
      return;
    }
    if (
      event.eventType !== OUTPUT_EVENT_TYPE.runtimeInputProcessed &&
      event.eventType !== OUTPUT_EVENT_TYPE.agentRunStateChanged &&
      event.eventType !== OUTPUT_EVENT_TYPE.agentTurnStateChanged
    ) {
      return;
    }

    try {
      this.eventSchemaRegistry.validateOutput(toOutputSnapshot(event));
    } catch {
      throw this.fail(request, event.sequence, RUNTIME_REPLAY_PLANNING_FAILURE.invalidEvent);
    }

    try {
      if (event.eventType === OUTPUT_EVENT_TYPE.runtimeInputProcessed) {
        this.applyInputOutcome(state, event);
      } else if (event.eventType === OUTPUT_EVENT_TYPE.agentRunStateChanged) {
        this.applyRunTransition(state, event);
      } else {
        this.applyTurnTransition(state, event);
      }
    } catch {
      throw this.fail(
        request,
        event.sequence,
        RUNTIME_REPLAY_PLANNING_FAILURE.historyConflict,
      );
    }
  }

  private applyInputOutcome(state: ReplayState, event: PersistedOutputEventSnapshot): void {
    const snapshot = event as RuntimeInputProcessedSnapshot;
    const input = requireReferencedInput(state, snapshot.inputEvent);
    if (state.processedInputIds.has(input.id)) throw new TypeError("duplicate outcome");
    const expectedId = this.eventIdFactory.create({
      scope: "input",
      conversationId: event.conversationId,
      eventType: event.eventType,
      inputEventId: input.id,
      ordinal: 0,
    });
    if (event.id !== expectedId) throw new TypeError("outcome identity mismatch");
    state.processedInputIds.add(input.id);
  }

  private applyRunTransition(state: ReplayState, event: PersistedOutputEventSnapshot): void {
    const snapshot = event as unknown as AgentRunStateChangedSnapshot;
    if (snapshot.runId === undefined) throw new TypeError("run identity missing");
    const input = requireReferencedInput(state, snapshot.payload.inputEvent);
    let transition: RunStateTransition;
    if (snapshot.payload.previous === null) {
      const priorTurn = state.turnState.getSnapshot();
      if (priorTurn !== undefined && !isTerminalTurn(priorTurn.status)) {
        throw new TypeError("active turn blocks next run");
      }
      transition = state.runState.begin({
        runId: snapshot.runId,
        inputEvent: snapshot.payload.inputEvent,
      });
      state.turnState = new TurnStateMachine();
    } else {
      assertRunTransitionCoordination(state.turnState.getSnapshot(), snapshot.payload.current);
      transition = state.runState.transition(toRunTransitionRequest(snapshot.payload));
    }
    assertRunTransitionMatches(transition, snapshot, input);
    const expectedId = this.eventIdFactory.create({
      scope: "run",
      conversationId: event.conversationId,
      eventType: event.eventType,
      runId: transition.runId,
      ordinal: transition.ordinal,
    });
    if (event.id !== expectedId) throw new TypeError("run event identity mismatch");
  }

  private applyTurnTransition(state: ReplayState, event: PersistedOutputEventSnapshot): void {
    const snapshot = event as unknown as AgentTurnStateChangedSnapshot;
    if (snapshot.runId === undefined || snapshot.turnId === undefined) {
      throw new TypeError("turn identity missing");
    }
    const run = state.runState.getSnapshot();
    if (run === undefined || run.runId !== snapshot.runId || isTerminalRun(run.status)) {
      throw new TypeError("turn run mismatch");
    }

    let transition: TurnStateTransition;
    if (snapshot.payload.previous === null) {
      if (run.status !== RUN_STATUS.running) throw new TypeError("run not running");
      transition = state.turnState.begin({
        runId: snapshot.runId,
        turnId: snapshot.turnId,
      });
    } else {
      transition = state.turnState.transition(toTurnTransitionRequest(snapshot.payload));
    }
    assertTurnTransitionMatches(transition, snapshot);
    const expectedId = this.eventIdFactory.create({
      scope: "turn",
      conversationId: event.conversationId,
      eventType: event.eventType,
      runId: transition.runId,
      turnId: transition.turnId,
      ordinal: transition.ordinal,
    });
    if (event.id !== expectedId) throw new TypeError("turn event identity mismatch");
  }

  private fail(
    request: RuntimeReplayRequest,
    sequence: number,
    failure: RuntimeReplayPlanningFailure,
  ): RuntimeReplayPlanningError {
    const error = new RuntimeReplayPlanningError(
      request.conversationId,
      request.throughSequence,
      sequence,
      failure,
    );
    this.logFailure(error);
    return error;
  }

  private logFailure(error: RuntimeReplayPlanningError): void {
    this.logger.error("runtime.replay.plan_failed", {
      conversationId: error.conversationId,
      throughSequence: error.throughSequence,
      sequence: error.sequence,
      failure: error.failure,
    });
  }
}

interface ReplayState {
  readonly inputs: Map<string, PersistedInputEventSnapshot>;
  readonly processedInputIds: Set<string>;
  readonly runState: RunStateMachine;
  turnState: TurnStateMachine;
  scannedEventCount: number;
}

interface RuntimeInputProcessedSnapshot extends PersistedOutputEventSnapshot {
  readonly inputEvent: DurableInputEventReference;
}

interface RunPayloadSnapshot {
  readonly inputEvent: DurableInputEventReference;
  readonly previous: RunStatus | null;
  readonly current: RunStatus;
  readonly reason: RunStateChangeReason;
  readonly cancellationReason?: ExecutionCancellationReason;
}

type AgentRunStateChangedSnapshot = Omit<
  PersistedOutputEventSnapshot,
  "runId" | "payload"
> & {
  readonly runId: string;
  readonly payload: RunPayloadSnapshot;
};

interface TurnPayloadSnapshot {
  readonly previous: TurnStatus | null;
  readonly current: TurnStatus;
  readonly reason: TurnStateChangeReason;
  readonly cancellationReason?: ExecutionCancellationReason;
}

type AgentTurnStateChangedSnapshot = Omit<
  PersistedOutputEventSnapshot,
  "runId" | "turnId" | "payload"
> & {
  readonly runId: string;
  readonly turnId: string;
  readonly payload: TurnPayloadSnapshot;
};

function createReplayState(): ReplayState {
  return {
    inputs: new Map(),
    processedInputIds: new Set(),
    runState: new RunStateMachine(),
    turnState: new TurnStateMachine(),
    scannedEventCount: 0,
  };
}

function captureRequest(request: RuntimeReplayRequest): RuntimeReplayRequest {
  if (
    request === null ||
    typeof request !== "object" ||
    typeof request.conversationId !== "string" ||
    request.conversationId.trim().length === 0 ||
    !Number.isSafeInteger(request.throughSequence) ||
    request.throughSequence < 0
  ) {
    throw new RuntimeReplayPlanningError(
      safeIdentifier(request?.conversationId),
      Number.isSafeInteger(request?.throughSequence) ? request.throughSequence : 0,
      0,
      RUNTIME_REPLAY_PLANNING_FAILURE.invalidRequest,
    );
  }
  return Object.freeze({
    conversationId: request.conversationId,
    throughSequence: request.throughSequence,
  });
}

function capturePageSize(pageSize: number): number {
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_RUNTIME_REPLAY_PAGE_SIZE
  ) {
    throw new TypeError("Runtime replay page size must be between 1 and 1000");
  }
  return pageSize;
}

function capturePlan(options: {
  conversationId: string;
  throughSequence: number;
  scannedEventCount: number;
  processedInputCount: number;
  pendingInputs: PersistedInputEventSnapshot[];
  run: RunStateSnapshot | undefined;
  turn: TurnStateSnapshot | undefined;
}): RuntimeReplayPlan {
  return Object.freeze({
    conversationId: options.conversationId,
    throughSequence: options.throughSequence,
    scannedEventCount: options.scannedEventCount,
    processedInputCount: options.processedInputCount,
    pendingInputs: Object.freeze([...options.pendingInputs]),
    ...(options.run !== undefined ? { run: options.run } : {}),
    ...(options.turn !== undefined ? { turn: options.turn } : {}),
  });
}

function toInputSnapshot(event: PersistedInputEventSnapshot): InputEventSnapshot {
  return {
    id: event.id,
    conversationId: event.conversationId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    priority: event.priority,
    timestamp: event.timestamp,
    ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {}),
    ...(event.causationId !== undefined ? { causationId: event.causationId } : {}),
    ...(event.runId !== undefined ? { runId: event.runId } : {}),
    ...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
    payload: event.payload,
  };
}

function toOutputSnapshot(event: PersistedOutputEventSnapshot): OutputEventSnapshot {
  const snapshot = { ...event } as Record<string, unknown>;
  delete snapshot.direction;
  delete snapshot.sequence;
  delete snapshot.recordedAt;
  return snapshot as unknown as OutputEventSnapshot;
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

function requireReferencedInput(
  state: ReplayState,
  reference: DurableInputEventReference,
): PersistedInputEventSnapshot {
  const input = state.inputs.get(reference.id);
  if (
    input === undefined ||
    input.eventType !== reference.eventType ||
    input.sequence !== reference.sequence
  ) {
    throw new TypeError("input reference mismatch");
  }
  return input;
}

function toRunTransitionRequest(payload: RunPayloadSnapshot): RunTransitionRequest {
  if (payload.current === RUN_STATUS.cancelled) {
    if (payload.cancellationReason === undefined) throw new TypeError("missing cancellation");
    return {
      current: payload.current,
      reason: payload.reason,
      cancellationReason: payload.cancellationReason,
    };
  }
  return { current: payload.current, reason: payload.reason };
}

function toTurnTransitionRequest(payload: TurnPayloadSnapshot): TurnTransitionRequest {
  if (payload.current === TURN_STATUS.cancelled) {
    if (payload.cancellationReason === undefined) throw new TypeError("missing cancellation");
    return {
      current: payload.current,
      reason: payload.reason,
      cancellationReason: payload.cancellationReason,
    };
  }
  return { current: payload.current, reason: payload.reason };
}

function assertRunTransitionMatches(
  transition: RunStateTransition,
  event: AgentRunStateChangedSnapshot,
  input: PersistedInputEventSnapshot,
): void {
  if (
    transition.runId !== event.runId ||
    transition.inputEvent.id !== input.id ||
    transition.inputEvent.eventType !== input.eventType ||
    transition.inputEvent.sequence !== input.sequence ||
    transition.previous !== event.payload.previous ||
    transition.current !== event.payload.current ||
    transition.reason !== event.payload.reason ||
    transition.cancellationReason !== event.payload.cancellationReason
  ) {
    throw new TypeError("run transition mismatch");
  }
}

function assertTurnTransitionMatches(
  transition: TurnStateTransition,
  event: AgentTurnStateChangedSnapshot,
): void {
  if (
    transition.runId !== event.runId ||
    transition.turnId !== event.turnId ||
    transition.previous !== event.payload.previous ||
    transition.current !== event.payload.current ||
    transition.reason !== event.payload.reason ||
    transition.cancellationReason !== event.payload.cancellationReason
  ) {
    throw new TypeError("turn transition mismatch");
  }
}

function assertRunTransitionCoordination(
  turn: TurnStateSnapshot | undefined,
  nextRunStatus: RunStatus,
): void {
  if (turn === undefined || isTerminalTurn(turn.status)) return;
  if (nextRunStatus === RUN_STATUS.stopping && turn.status === TURN_STATUS.stopping) return;
  throw new TypeError("active turn blocks run transition");
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
