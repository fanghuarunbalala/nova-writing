/** Converts durable Child Run terminals into the existing idempotent Subagent result path. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { SubagentBindingStore } from "./SubagentBindingStore.js";
import {
  SUBAGENT_CANCELLATION_REASON,
  SUBAGENT_SCHEMA_VERSION,
  type SubagentCancellationReason,
  type SubagentResult,
  type SubagentBinding,
} from "./SubagentProtocol.js";
import {
  SUBAGENT_SUMMARY_MAX_BYTES,
  captureSubagentResult,
  clampSubagentText,
} from "./SubagentProtocolValidator.js";
import type {
  SubagentFinalAssistantMessage,
  SubagentFinalAssistantMessageReader,
} from "./SubagentTaskQueryService.js";
import {
  SUBAGENT_TASK_PROTOCOL_FAILURE,
  SubagentTaskProtocolError,
} from "./SubagentTaskProtocolErrors.js";

export interface SubagentTerminalRunObservation {
  readonly subagentId: string;
  readonly status: "completed" | "failed" | "cancelled" | "orphaned";
  readonly completedAt: string;
  readonly errorCode?: string;
  readonly cancellationReason?: SubagentCancellationReason;
}

export interface SubagentCompletionResultSink {
  deliverResult(result: SubagentResult): Promise<SubagentResult>;
}

export interface SubagentCompletionBridgeOptions {
  readonly bindings: SubagentBindingStore;
  readonly finalAssistantMessages: SubagentFinalAssistantMessageReader;
  readonly resultSink: SubagentCompletionResultSink;
  readonly logger?: Logger;
}

export class SubagentCompletionBridge {
  readonly #logger: Logger;

  constructor(private readonly options: SubagentCompletionBridgeOptions) {
    this.#logger = (options.logger ?? noopLogger).child({
      component: "subagent_completion_bridge",
    });
  }

  async reconcile(observation: SubagentTerminalRunObservation): Promise<SubagentResult> {
    const binding = await this.options.bindings.get(observation.subagentId);
    if (binding === undefined) {
      this.#logger.info("runtime.subagent.completion.task_not_found", {
        taskId: observation.subagentId,
        terminalStatus: observation.status,
      });
      throw new SubagentTaskProtocolError(
        SUBAGENT_TASK_PROTOCOL_FAILURE.taskNotFound,
        observation.subagentId,
      );
    }

    let result: SubagentResult;
    if (observation.status === "completed") {
      const message = await this.options.finalAssistantMessages
        .readFinalAssistantMessage(binding.childConversationId);
      result = createCompletedResult(binding, observation, message);
    } else if (observation.status === "failed") {
      result = createFailedResult(binding, observation);
    } else {
      result = createCancelledResult(binding, observation);
    }

    const captured = captureSubagentResult(result, binding);
    this.#logger.info("runtime.subagent.completion.reconciled", {
      taskId: captured.subagentId,
      status: captured.status,
    });
    return this.options.resultSink.deliverResult(captured);
  }
}

function createCompletedResult(
  binding: SubagentBinding,
  observation: SubagentTerminalRunObservation,
  message: SubagentFinalAssistantMessage | undefined,
): SubagentResult {
  if (message === undefined) {
    return createFailedResult(binding, {
      ...observation,
      status: "failed",
      errorCode: "SUBAGENT_EMPTY_RESULT",
    });
  }
  return {
    schemaVersion: SUBAGENT_SCHEMA_VERSION,
    subagentId: binding.subagentId,
    parentConversationId: binding.parentConversationId,
    parentRunId: binding.parentRunId,
    childConversationId: binding.childConversationId,
    status: "completed",
    // 超长正文按 SUBAGENT_SUMMARY_MAX_BYTES 截断而非交给 captureSubagentResult throw，
    // 否则 binding 卡在 running 且 observer 无限 observe_failed。Over-limit content is
    // clamped here so captureSubagentResult never throws and the binding completes.
    summary: clampSubagentText(message.content, SUBAGENT_SUMMARY_MAX_BYTES),
    artifactReferences: message.artifactReferences,
    completedAt: observation.completedAt,
  };
}

function createFailedResult(
  binding: SubagentBinding,
  observation: SubagentTerminalRunObservation,
): SubagentResult {
  return {
    schemaVersion: SUBAGENT_SCHEMA_VERSION,
    subagentId: binding.subagentId,
    parentConversationId: binding.parentConversationId,
    parentRunId: binding.parentRunId,
    childConversationId: binding.childConversationId,
    status: "failed",
    artifactReferences: [],
    errorCode: observation.errorCode ?? "SUBAGENT_RUN_FAILED",
    completedAt: observation.completedAt,
  };
}

function createCancelledResult(
  binding: SubagentBinding,
  observation: SubagentTerminalRunObservation,
): SubagentResult {
  const cancellationReason = observation.cancellationReason ??
    SUBAGENT_CANCELLATION_REASON.explicit;
  return {
    schemaVersion: SUBAGENT_SCHEMA_VERSION,
    subagentId: binding.subagentId,
    parentConversationId: binding.parentConversationId,
    parentRunId: binding.parentRunId,
    childConversationId: binding.childConversationId,
    status: observation.status,
    artifactReferences: [],
    cancellationReason,
    completedAt: observation.completedAt,
  };
}
