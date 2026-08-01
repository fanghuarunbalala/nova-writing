/** Maps the Core Stop cancellation contract onto an Agent Runtime Adapter. */
import {
  INPUT_EVENT_TYPE,
  captureDurableInputEventReference,
  type DurableInputEventReference,
} from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { AgentRuntimeAdapter } from "../../agent/index.js";
import { EXECUTION_CANCELLATION_REASON } from "../ExecutionCancellationReason.js";
import type {
  RuntimeStopCancellationPort,
  RuntimeStopCancellationRequest,
} from "../control/RuntimeStopInputHandler.js";
import {
  AGENT_RUNTIME_STOP_CANCELLATION_FAILURE,
  AgentRuntimeStopCancellationPortError,
  type AgentRuntimeStopCancellationFailure,
} from "./AgentRuntimeStopCancellationPortErrors.js";

export interface AgentRuntimeStopCancellationPortOptions {
  conversationId: string;
  agentAdapter: AgentRuntimeAdapter;
  logger?: Logger;
}

interface CapturedStopCancellationRequest {
  readonly conversationId: string;
  readonly reason: "stop";
  readonly stopInput: DurableInputEventReference;
  readonly runId: string;
  readonly turnId?: string;
}

export class AgentRuntimeStopCancellationPort
  implements RuntimeStopCancellationPort
{
  private readonly conversationId: string;
  private readonly agentAdapter: AgentRuntimeAdapter;
  private readonly logger: Logger;

  constructor(options: AgentRuntimeStopCancellationPortOptions) {
    assertNonBlank("Conversation ID", options.conversationId);
    this.conversationId = options.conversationId;
    this.agentAdapter = options.agentAdapter;
    this.logger = (options.logger ?? noopLogger).child({
      component: "agent_runtime_stop_cancellation_port",
      conversationId: this.conversationId,
    });
  }

  async cancel(request: RuntimeStopCancellationRequest): Promise<void> {
    let captured: CapturedStopCancellationRequest;
    try {
      captured = captureRequest(request, this.conversationId);
    } catch {
      throw this.fail(AGENT_RUNTIME_STOP_CANCELLATION_FAILURE.invalidRequest);
    }

    this.logger.info("runtime.agent_stop.cancellation_started", {
      ...toLogIdentity(captured),
      hasTurn: captured.turnId !== undefined,
    });
    try {
      await this.agentAdapter.cancel(
        Object.freeze({
          conversationId: captured.conversationId,
          runId: captured.runId,
          ...(captured.turnId !== undefined ? { turnId: captured.turnId } : {}),
          reason: EXECUTION_CANCELLATION_REASON.stop,
        }),
      );
    } catch {
      throw this.fail(
        AGENT_RUNTIME_STOP_CANCELLATION_FAILURE.adapterFailed,
        captured.runId,
        captured,
      );
    }
    this.logger.info("runtime.agent_stop.cancellation_completed", {
      ...toLogIdentity(captured),
      hasTurn: captured.turnId !== undefined,
    });
  }

  private fail(
    failure: AgentRuntimeStopCancellationFailure,
    runId?: string,
    request?: CapturedStopCancellationRequest,
  ): AgentRuntimeStopCancellationPortError {
    this.logger.error("runtime.agent_stop.cancellation_failed", {
      failure,
      ...(request !== undefined ? toLogIdentity(request) : {}),
      ...(request === undefined && runId !== undefined ? { runId } : {}),
    });
    return new AgentRuntimeStopCancellationPortError(
      this.conversationId,
      runId,
      failure,
    );
  }
}

function captureRequest(
  request: RuntimeStopCancellationRequest,
  conversationId: string,
): CapturedStopCancellationRequest {
  if (
    request === null ||
    typeof request !== "object" ||
    request.conversationId !== conversationId ||
    request.reason !== EXECUTION_CANCELLATION_REASON.stop ||
    captureNonBlank(request.runId) === undefined ||
    (request.turnId !== undefined && captureNonBlank(request.turnId) === undefined)
  ) {
    throw new TypeError("Agent Runtime Stop cancellation request is invalid");
  }
  const stopInput = captureDurableInputEventReference(request.stopInput);
  if (stopInput.eventType !== INPUT_EVENT_TYPE.systemStop) {
    throw new TypeError("Agent Runtime Stop Input reference is invalid");
  }
  return Object.freeze({
    conversationId,
    reason: EXECUTION_CANCELLATION_REASON.stop,
    stopInput,
    runId: request.runId,
    ...(request.turnId !== undefined ? { turnId: request.turnId } : {}),
  });
}

function toLogIdentity(request: CapturedStopCancellationRequest): Readonly<{
  runId: string;
  stopInputEventId: string;
  stopInputSequence: number;
  turnId?: string;
}> {
  return {
    runId: request.runId,
    stopInputEventId: request.stopInput.id,
    stopInputSequence: request.stopInput.sequence,
    ...(request.turnId !== undefined ? { turnId: request.turnId } : {}),
  };
}

function assertNonBlank(label: string, value: string): void {
  if (captureNonBlank(value) === undefined) {
    throw new TypeError(`${label} must not be blank`);
  }
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
