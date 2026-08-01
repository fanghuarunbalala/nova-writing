/**
 * Maps Pi Turn boundaries to persistence-first Core Turn transitions.
 *
 * Message and Tool events remain untouched; stopping/cancelled Turn ownership
 * remains with the Runtime cancellation coordinator.
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  RUN_STATUS,
  TURN_STATE_CHANGE_REASON,
  TURN_STATUS,
  type RunStateSnapshot,
  type TurnLifecycleCommit,
  type TurnStateSnapshot,
  type TurnTransitionRequest,
} from "../../execution/index.js";
import type { BeginControlledTurnOptions } from "../../execution/control/TurnController.js";
import type { PiAgentEventBridge, PiAgentEventBridgeRequest } from "./PiAgentEventBridge.js";
import {
  PI_TURN_LIFECYCLE_BRIDGE_FAILURE,
  PiTurnLifecycleBridgeError,
  type PiTurnLifecycleBridgeFailure,
} from "./PiTurnLifecycleBridgeErrors.js";

export interface PiTurnLifecycleController {
  getRunSnapshot(): RunStateSnapshot | undefined;
  getTurnSnapshot(): TurnStateSnapshot | undefined;
  beginTurn(options?: BeginControlledTurnOptions): Promise<TurnLifecycleCommit>;
  transitionTurn(request: TurnTransitionRequest): Promise<TurnLifecycleCommit>;
}

export interface PiTurnLifecycleBridgeOptions {
  conversationId: string;
  lifecycleController: PiTurnLifecycleController;
  logger?: Logger;
}

export class PiTurnLifecycleBridge implements PiAgentEventBridge {
  private readonly conversationId: string;
  private readonly lifecycleController: PiTurnLifecycleController;
  private readonly logger: Logger;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: PiTurnLifecycleBridgeOptions) {
    assertNonBlank(options.conversationId);
    this.conversationId = options.conversationId;
    this.lifecycleController = options.lifecycleController;
    this.logger = (options.logger ?? noopLogger).child({
      component: "pi_turn_lifecycle_bridge",
      conversationId: this.conversationId,
    });
  }

  handle(request: PiAgentEventBridgeRequest): Promise<void> {
    let captured: PiAgentEventBridgeRequest;
    try {
      captured = captureRequest(request);
    } catch {
      return Promise.reject(
        this.fail(
          PI_TURN_LIFECYCLE_BRIDGE_FAILURE.invalidRequest,
          captureNonBlank(request?.runId),
        ),
      );
    }
    return this.serialize(() => this.handleCaptured(captured));
  }

  private async handleCaptured(request: PiAgentEventBridgeRequest): Promise<void> {
    if (request.conversationId !== this.conversationId) {
      throw this.fail(PI_TURN_LIFECYCLE_BRIDGE_FAILURE.invalidRequest, request.runId);
    }

    switch (request.event.type) {
      case "agent_start":
        this.requireRun(request.runId, true);
        return;
      case "turn_start":
        await this.beginTurn(request.runId);
        return;
      case "turn_end":
        await this.endTurn(request);
        return;
      case "agent_end":
        this.assertAgentEnd(request.runId);
        return;
      default:
        return;
    }
  }

  private async beginTurn(runId: string): Promise<void> {
    this.requireRun(runId, true);
    try {
      const commit = await this.lifecycleController.beginTurn();
      if (
        commit.scope !== "turn" ||
        commit.transition.runId !== runId ||
        commit.transition.current !== TURN_STATUS.running ||
        commit.transition.reason !== TURN_STATE_CHANGE_REASON.providerStarted
      ) {
        throw new TypeError("Turn start commit is invalid");
      }
      this.logger.info("runtime.agent.turn_started", {
        runId,
        turnId: commit.transition.turnId,
        receiptSequence: commit.receipt.sequence,
      });
    } catch (error) {
      if (error instanceof PiTurnLifecycleBridgeError) throw error;
      throw this.fail(PI_TURN_LIFECYCLE_BRIDGE_FAILURE.lifecycleCommit, runId);
    }
  }

  private async endTurn(request: PiAgentEventBridgeRequest): Promise<void> {
    const run = this.requireRun(request.runId, false);
    const turn = this.requireTurn(request.runId);
    if (turn.status === TURN_STATUS.stopping || turn.status === TURN_STATUS.cancelled) {
      this.logger.debug("runtime.agent.turn_end_deferred", {
        runId: request.runId,
        turnId: turn.turnId,
        turnStatus: turn.status,
      });
      return;
    }
    if (isTerminalTurn(turn.status)) {
      throw this.fail(
        PI_TURN_LIFECYCLE_BRIDGE_FAILURE.turnAlreadyTerminal,
        request.runId,
        turn.turnId,
      );
    }
    if (request.signal.aborted || run.status === RUN_STATUS.stopping) {
      throw this.fail(
        PI_TURN_LIFECYCLE_BRIDGE_FAILURE.cancellationState,
        request.runId,
        turn.turnId,
      );
    }
    if (request.event.type !== "turn_end" || request.event.message.role !== "assistant") {
      throw this.fail(
        PI_TURN_LIFECYCLE_BRIDGE_FAILURE.invalidRequest,
        request.runId,
        turn.turnId,
      );
    }

    const failed =
      request.event.message.stopReason === "error" ||
      request.event.message.stopReason === "aborted";
    const transition: TurnTransitionRequest = failed
      ? {
          current: TURN_STATUS.failed,
          reason: TURN_STATE_CHANGE_REASON.turnFailed,
        }
      : {
          current: TURN_STATUS.completed,
          reason: TURN_STATE_CHANGE_REASON.turnCompleted,
        };
    try {
      const commit = await this.lifecycleController.transitionTurn(transition);
      if (
        commit.scope !== "turn" ||
        commit.transition.runId !== request.runId ||
        commit.transition.turnId !== turn.turnId ||
        commit.transition.current !== transition.current ||
        commit.transition.reason !== transition.reason
      ) {
        throw new TypeError("Turn terminal commit is invalid");
      }
      this.logger.info("runtime.agent.turn_terminal", {
        runId: request.runId,
        turnId: turn.turnId,
        turnStatus: transition.current,
        receiptSequence: commit.receipt.sequence,
      });
    } catch (error) {
      if (error instanceof PiTurnLifecycleBridgeError) throw error;
      throw this.fail(
        PI_TURN_LIFECYCLE_BRIDGE_FAILURE.lifecycleCommit,
        request.runId,
        turn.turnId,
      );
    }
  }

  private assertAgentEnd(runId: string): void {
    this.requireRun(runId, false);
    const turn = this.lifecycleController.getTurnSnapshot();
    if (
      turn !== undefined &&
      turn.runId === runId &&
      !isTerminalTurn(turn.status) &&
      turn.status !== TURN_STATUS.stopping
    ) {
      throw this.fail(
        PI_TURN_LIFECYCLE_BRIDGE_FAILURE.agentEndWithActiveTurn,
        runId,
        turn.turnId,
      );
    }
  }

  private requireRun(runId: string, requireRunning: boolean): RunStateSnapshot {
    const run = this.lifecycleController.getRunSnapshot();
    if (run === undefined || run.runId !== runId) {
      throw this.fail(PI_TURN_LIFECYCLE_BRIDGE_FAILURE.runMismatch, runId);
    }
    if (requireRunning && run.status !== RUN_STATUS.running) {
      throw this.fail(PI_TURN_LIFECYCLE_BRIDGE_FAILURE.runNotRunning, runId);
    }
    return run;
  }

  private requireTurn(runId: string): TurnStateSnapshot {
    const turn = this.lifecycleController.getTurnSnapshot();
    if (turn === undefined) {
      throw this.fail(PI_TURN_LIFECYCLE_BRIDGE_FAILURE.turnMissing, runId);
    }
    if (turn.runId !== runId) {
      throw this.fail(
        PI_TURN_LIFECYCLE_BRIDGE_FAILURE.turnMismatch,
        runId,
        turn.turnId,
      );
    }
    return turn;
  }

  private fail(
    failure: PiTurnLifecycleBridgeFailure,
    runId?: string,
    turnId?: string,
  ): PiTurnLifecycleBridgeError {
    this.logger.error("runtime.agent.turn_lifecycle_failed", {
      failure,
      ...(runId !== undefined ? { runId } : {}),
      ...(turnId !== undefined ? { turnId } : {}),
    });
    return new PiTurnLifecycleBridgeError(
      failure,
      this.conversationId,
      runId,
      turnId,
    );
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function captureRequest(request: PiAgentEventBridgeRequest): PiAgentEventBridgeRequest {
  if (
    request === null ||
    typeof request !== "object" ||
    typeof request.conversationId !== "string" ||
    request.conversationId.trim().length === 0 ||
    typeof request.runId !== "string" ||
    request.runId.trim().length === 0 ||
    request.event === null ||
    typeof request.event !== "object" ||
    !isPiAgentEventType(request.event.type) ||
    request.signal === null ||
    typeof request.signal !== "object" ||
    typeof request.signal.aborted !== "boolean"
  ) {
    throw new TypeError("Pi Agent event bridge request is invalid");
  }
  return request;
}

const PI_AGENT_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

function isPiAgentEventType(value: unknown): value is PiAgentEventBridgeRequest["event"]["type"] {
  return typeof value === "string" && PI_AGENT_EVENT_TYPES.has(value);
}

function isTerminalTurn(status: TurnStateSnapshot["status"]): boolean {
  return (
    status === TURN_STATUS.completed ||
    status === TURN_STATUS.failed ||
    status === TURN_STATUS.cancelled
  );
}

function assertNonBlank(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Conversation ID must not be blank");
  }
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
