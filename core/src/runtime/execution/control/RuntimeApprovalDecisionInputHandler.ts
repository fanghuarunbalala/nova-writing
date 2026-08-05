/**
 * Resolves one durable Tool approval decision through the shared interaction
 * coordinator and records the control input outcome.
 */
import {
  captureDurableInputEventReference,
  INPUT_EVENT_TYPE,
} from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import type { InteractionCoordinator } from "../../interaction/index.js";
import type { RuntimeInputPumpHandler } from "../input/RuntimeInputPump.js";
import {
  RUNTIME_APPROVAL_DECISION_FAILURE,
  RuntimeApprovalDecisionInputError,
} from "./RuntimeApprovalDecisionInputHandlerErrors.js";
import type {
  RecordRuntimeInputOutcomeOptions,
  RuntimeInputOutcomeCommit,
} from "./RuntimeInputOutcomeController.js";

export interface RuntimeApprovalDecisionInputHandlerOptions {
  readonly conversationId: string;
  readonly coordinator: InteractionCoordinator;
  readonly runId?: () => string | undefined;
  readonly turnId?: () => string | undefined;
  readonly outcomeRecorder: {
    record(
      options: RecordRuntimeInputOutcomeOptions,
    ): Promise<RuntimeInputOutcomeCommit>;
  };
  readonly logger?: Logger;
}

export class RuntimeApprovalDecisionInputHandler
  implements RuntimeInputPumpHandler
{
  private readonly conversationId: string;
  private readonly coordinator: InteractionCoordinator;
  private readonly runId?: () => string | undefined;
  private readonly turnId?: () => string | undefined;
  private readonly outcomeRecorder: RuntimeApprovalDecisionInputHandlerOptions["outcomeRecorder"];
  private readonly logger: Logger;

  constructor(options: RuntimeApprovalDecisionInputHandlerOptions) {
    this.conversationId = options.conversationId;
    this.coordinator = options.coordinator;
    this.runId = options.runId;
    this.turnId = options.turnId;
    this.outcomeRecorder = options.outcomeRecorder;
    this.logger = (options.logger ?? noopLogger).child({
      component: "runtime_approval_decision_input_handler",
      conversationId: this.conversationId,
    });
  }

  async handle(input: PersistedInputEventSnapshot): Promise<void> {
    if (input.eventType !== INPUT_EVENT_TYPE.approvalDecision) {
      throw new RuntimeApprovalDecisionInputError(
        RUNTIME_APPROVAL_DECISION_FAILURE.unexpectedEventType,
        this.conversationId,
      );
    }
    try {
      const enriched = enrichDecisionInput(input, this.runId, this.turnId);
      const result = await this.coordinator.resolve(enriched, {
        actorId: `conversation:${this.conversationId}`,
      });
      this.logger.info("runtime.approval_decision.resolved", {
        inputEventId: input.id,
        outcome: result.outcome,
      });
      await this.outcomeRecorder.record({
        inputEvent: captureDurableInputEventReference(input),
        outcome: "consumed",
      });
    } catch (error) {
      this.logger.warn("runtime.approval_decision.failed", {
        inputEventId: input.id,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }
  }
}

function enrichDecisionInput(
  input: PersistedInputEventSnapshot,
  runId: (() => string | undefined) | undefined,
  turnId: (() => string | undefined) | undefined,
): PersistedInputEventSnapshot {
  const currentRunId = runId?.();
  const currentTurnId = turnId?.();
  if (
    (input.runId !== undefined || currentRunId === undefined) &&
    (input.turnId !== undefined || currentTurnId === undefined)
  ) {
    return input;
  }
  return Object.freeze({
    ...input,
    ...(input.runId === undefined && currentRunId !== undefined
      ? { runId: currentRunId }
      : {}),
    ...(input.turnId === undefined && currentTurnId !== undefined
      ? { turnId: currentTurnId }
      : {}),
  });
}
