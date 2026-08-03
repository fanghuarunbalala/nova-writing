/**
 * Claims one durable UserMessage as a Core Run before delegating execution.
 *
 * The executor owns Provider/Pi and Turn behavior, but must return only after
 * the claimed Run has reached one durable terminal state.
 */
import {
  canonicalStringifyJson,
  captureDurableInputEventReference,
  isAgentTurnInputEventType,
  type DurableInputEventReference,
  type JsonValue,
} from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import { RUN_STATE_CHANGE_REASON, RUN_STATUS, type RunStatus } from "../RunLifecycle.js";
import type { RuntimeInputPumpHandler } from "../input/RuntimeInputPump.js";
import type { RunStateSnapshot } from "../state/RunStateMachine.js";
import type {
  BeginControlledRunOptions,
  LifecycleEventMetadata,
  RunLifecycleCommit,
} from "./TurnController.js";
import type {
  RecordRuntimeInputOutcomeOptions,
  RuntimeInputOutcomeCommit,
} from "./RuntimeInputOutcomeController.js";
import {
  RUNTIME_USER_MESSAGE_INPUT_FAILURE,
  RuntimeUserMessageInputHandlerError,
  type RuntimeUserMessageInputFailure,
} from "./RuntimeUserMessageInputHandlerErrors.js";

export interface RuntimeUserMessageLifecycleController {
  getRunSnapshot(): RunStateSnapshot | undefined;
  beginRun(options: BeginControlledRunOptions): Promise<RunLifecycleCommit>;
  transitionRun(
    request: {
      current: "running";
      reason: "execution_started";
    },
    metadata?: LifecycleEventMetadata,
  ): Promise<RunLifecycleCommit>;
}

export interface RuntimeUserMessageOutcomeRecorder {
  record(options: RecordRuntimeInputOutcomeOptions): Promise<RuntimeInputOutcomeCommit>;
}

export interface RuntimeRunExecutionRequest {
  readonly conversationId: string;
  readonly runId: string;
  readonly input: PersistedInputEventSnapshot;
}

export interface RuntimeRunExecutor {
  execute(request: RuntimeRunExecutionRequest): Promise<void>;
}

export interface RuntimeUserMessageInputResult {
  readonly inputEvent: DurableInputEventReference;
  readonly runId: string;
  readonly terminalStatus: Extract<RunStatus, "completed" | "failed" | "cancelled">;
  readonly outcomeReceiptSequence: number;
}

export interface RuntimeUserMessageInputHandlerOptions {
  conversationId: string;
  lifecycleController: RuntimeUserMessageLifecycleController;
  outcomeRecorder: RuntimeUserMessageOutcomeRecorder;
  runExecutor: RuntimeRunExecutor;
  logger?: Logger;
}

export class RuntimeUserMessageInputHandler implements RuntimeInputPumpHandler {
  private readonly conversationId: string;
  private readonly lifecycleController: RuntimeUserMessageLifecycleController;
  private readonly outcomeRecorder: RuntimeUserMessageOutcomeRecorder;
  private readonly runExecutor: RuntimeRunExecutor;
  private readonly logger: Logger;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: RuntimeUserMessageInputHandlerOptions) {
    assertNonBlank(options.conversationId);
    this.conversationId = options.conversationId;
    this.lifecycleController = options.lifecycleController;
    this.outcomeRecorder = options.outcomeRecorder;
    this.runExecutor = options.runExecutor;
    this.logger = (options.logger ?? noopLogger).child({
      component: "runtime_user_message_input_handler",
      conversationId: this.conversationId,
    });
  }

  async handle(input: PersistedInputEventSnapshot): Promise<void> {
    await this.process(input);
  }

  process(input: PersistedInputEventSnapshot): Promise<RuntimeUserMessageInputResult> {
    let captured: PersistedInputEventSnapshot;
    try {
      captured = captureUserMessageInput(input, this.conversationId);
    } catch {
      return Promise.reject(
        this.fail(RUNTIME_USER_MESSAGE_INPUT_FAILURE.invalidInput),
      );
    }
    return this.serialize(() => this.processCaptured(captured));
  }

  private async processCaptured(
    input: PersistedInputEventSnapshot,
  ): Promise<RuntimeUserMessageInputResult> {
    const inputEvent = captureDurableInputEventReference({
      id: input.id,
      eventType: input.eventType,
      sequence: input.sequence,
    });
    const metadata = captureMetadata(input);
    this.logger.info("runtime.user_message.processing_started", toLogIdentity(input));

    const activeRun = this.lifecycleController.getRunSnapshot();
    if (activeRun !== undefined && !isTerminalRunStatus(activeRun.status)) {
      throw this.fail(RUNTIME_USER_MESSAGE_INPUT_FAILURE.activeRun, input);
    }

    let runId: string;
    try {
      const queuedCommit = await this.lifecycleController.beginRun({
        inputEvent,
        ...metadata,
      });
      runId = captureQueuedRunId(queuedCommit, inputEvent);
    } catch {
      throw this.fail(RUNTIME_USER_MESSAGE_INPUT_FAILURE.beginRunFailed, input);
    }

    let outcomeCommit: RuntimeInputOutcomeCommit;
    try {
      outcomeCommit = await this.outcomeRecorder.record({
        inputEvent,
        outcome: "consumed",
        runId,
        ...metadata,
      });
      assertConsumedOutcome(outcomeCommit, inputEvent);
    } catch {
      throw this.fail(RUNTIME_USER_MESSAGE_INPUT_FAILURE.outcomeFailed, input, runId);
    }
    this.logger.info("runtime.user_message.claimed", {
      ...toLogIdentity(input),
      runId,
      outcomeSequence: outcomeCommit.receipt.sequence,
    });

    try {
      const runningCommit = await this.lifecycleController.transitionRun(
        {
          current: RUN_STATUS.running,
          reason: RUN_STATE_CHANGE_REASON.executionStarted,
        },
        metadata,
      );
      assertRunningCommit(runningCommit, runId);
    } catch {
      throw this.fail(RUNTIME_USER_MESSAGE_INPUT_FAILURE.startRunFailed, input, runId);
    }
    this.logger.info("runtime.user_message.execution_started", {
      ...toLogIdentity(input),
      runId,
    });

    try {
      await this.runExecutor.execute(
        Object.freeze({
          conversationId: this.conversationId,
          runId,
          input,
        }),
      );
    } catch {
      throw this.fail(RUNTIME_USER_MESSAGE_INPUT_FAILURE.executorFailed, input, runId);
    }

    const terminal = this.lifecycleController.getRunSnapshot();
    if (
      terminal === undefined ||
      terminal.runId !== runId ||
      !isTerminalRunStatus(terminal.status)
    ) {
      throw this.fail(RUNTIME_USER_MESSAGE_INPUT_FAILURE.runNotTerminal, input, runId);
    }
    this.logger.info("runtime.user_message.processing_completed", {
      ...toLogIdentity(input),
      runId,
      runStatus: terminal.status,
    });
    return Object.freeze({
      inputEvent,
      runId,
      terminalStatus: terminal.status,
      outcomeReceiptSequence: outcomeCommit.receipt.sequence,
    });
  }

  private fail(
    failure: RuntimeUserMessageInputFailure,
    input?: PersistedInputEventSnapshot,
    runId?: string,
  ): RuntimeUserMessageInputHandlerError {
    this.logger.error("runtime.user_message.processing_failed", {
      failure,
      ...(input !== undefined ? toLogIdentity(input) : {}),
      ...(runId !== undefined ? { runId } : {}),
    });
    return new RuntimeUserMessageInputHandlerError(this.conversationId, failure);
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

function captureUserMessageInput(
  input: PersistedInputEventSnapshot,
  conversationId: string,
): PersistedInputEventSnapshot {
  if (
    input === null ||
    typeof input !== "object" ||
    input.direction !== "input" ||
    input.conversationId !== conversationId ||
    !isAgentTurnInputEventType(input.eventType) ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence <= 0
  ) {
    throw new TypeError("Runtime UserMessage Input is invalid");
  }
  return deepFreezeJson(
    JSON.parse(canonicalStringifyJson(input as unknown as JsonValue)),
  ) as PersistedInputEventSnapshot;
}

function captureMetadata(input: PersistedInputEventSnapshot): LifecycleEventMetadata {
  return Object.freeze({
    ...(input.correlationId !== undefined
      ? { correlationId: input.correlationId }
      : {}),
    causationId: input.id,
  });
}

function captureQueuedRunId(
  commit: RunLifecycleCommit,
  inputEvent: DurableInputEventReference,
): string {
  const transition = commit.transition;
  if (
    commit.scope !== "run" ||
    transition.current !== RUN_STATUS.queued ||
    transition.reason !== RUN_STATE_CHANGE_REASON.inputQueued ||
    transition.inputEvent.id !== inputEvent.id ||
    transition.inputEvent.eventType !== inputEvent.eventType ||
    transition.inputEvent.sequence !== inputEvent.sequence ||
    typeof transition.runId !== "string" ||
    transition.runId.trim().length === 0
  ) {
    throw new TypeError("Queued Run commit is invalid");
  }
  return transition.runId;
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
    throw new TypeError("Consumed Input outcome commit is invalid");
  }
}

function assertRunningCommit(commit: RunLifecycleCommit, runId: string): void {
  if (
    commit.scope !== "run" ||
    commit.transition.runId !== runId ||
    commit.transition.current !== RUN_STATUS.running ||
    commit.transition.reason !== RUN_STATE_CHANGE_REASON.executionStarted
  ) {
    throw new TypeError("Running Run commit is invalid");
  }
}

function isTerminalRunStatus(
  status: RunStatus,
): status is Extract<RunStatus, "completed" | "failed" | "cancelled"> {
  return (
    status === RUN_STATUS.completed ||
    status === RUN_STATUS.failed ||
    status === RUN_STATUS.cancelled
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
