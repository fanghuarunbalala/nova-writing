/** Composes Bootstrap replay, reconciliation, and ready-plan execution once. */
import {
  CONVERSATION_RUNTIME_ACTIVATION_REASON,
  type ConversationRuntimeActivationReason,
} from "../../../conversation/host/ConversationRuntimeActivation.js";
import {
  CONVERSATION_RUNTIME_BOOTSTRAP_SCHEMA_VERSION,
  type ConversationRuntimeBootstrap,
} from "../../../conversation/host/ConversationRuntimeBootstrap.js";
import { isEventType } from "../../../event/protocol/EventType.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { RuntimeReplayPlan, RuntimeReplayPlanner } from "../source/RuntimeReplayPlanner.js";
import type { RunStatus } from "../RunLifecycle.js";
import type { TurnStatus } from "../TurnLifecycle.js";
import {
  RUNTIME_STARTUP_LIFECYCLE_DISPOSITION,
  type RuntimeStartupPlan,
} from "./RuntimeStartupReconciler.js";
import type { RuntimeStartupExecutionResult } from "./RuntimeStartupExecutor.js";
import {
  RUNTIME_BOOTSTRAP_STARTUP_FAILURE,
  RuntimeBootstrapStartupError,
  type RuntimeBootstrapStartupFailure,
} from "./RuntimeBootstrapStartupError.js";

export interface RuntimeStartupPlanReconciler {
  reconcile(replay: RuntimeReplayPlan): RuntimeStartupPlan;
}

export interface RuntimeReadyStartupExecutor {
  execute(plan: RuntimeStartupPlan): Promise<RuntimeStartupExecutionResult>;
}

export interface RuntimeBootstrapStartupResult {
  readonly conversationId: string;
  readonly runtimeInstanceId: string;
  readonly activationReason: ConversationRuntimeActivationReason;
  readonly throughSequence: number;
  readonly scannedEventCount: number;
  readonly processedInputCount: number;
  readonly outcomeRepairCount: number;
  readonly routedInputCount: number;
  readonly restoredRunId?: string;
  readonly restoredRunStatus?: RunStatus;
  readonly restoredTurnId?: string;
  readonly restoredTurnStatus?: TurnStatus;
}

export interface RuntimeBootstrapStartupCoordinatorOptions {
  conversationId: string;
  runtimeInstanceId: string;
  replayPlanner: RuntimeReplayPlanner;
  startupReconciler: RuntimeStartupPlanReconciler;
  startupExecutor: RuntimeReadyStartupExecutor;
  /**
   * 启动完成后结算上一实例遗留挂起审批的挂钩（best-effort，失败仅记录）。
   * Optional hook invoked after startup execution to settle approvals orphaned
   * by a previous runtime instance; failures are logged, never fatal.
   */
  orphanedApprovalSettler?: (conversationId: string) => Promise<void>;
  logger?: Logger;
}

export class RuntimeBootstrapStartupCoordinator {
  private readonly conversationId: string;
  private readonly runtimeInstanceId: string;
  private readonly replayPlanner: RuntimeReplayPlanner;
  private readonly startupReconciler: RuntimeStartupPlanReconciler;
  private readonly startupExecutor: RuntimeReadyStartupExecutor;
  private readonly orphanedApprovalSettler?: (conversationId: string) => Promise<void>;
  private readonly logger: Logger;
  private tail: Promise<void> = Promise.resolve();
  private started = false;

  constructor(options: RuntimeBootstrapStartupCoordinatorOptions) {
    assertNonBlank(options.conversationId);
    assertNonBlank(options.runtimeInstanceId);
    this.conversationId = options.conversationId;
    this.runtimeInstanceId = options.runtimeInstanceId;
    this.replayPlanner = options.replayPlanner;
    this.startupReconciler = options.startupReconciler;
    this.startupExecutor = options.startupExecutor;
    this.orphanedApprovalSettler = options.orphanedApprovalSettler;
    this.logger = (options.logger ?? noopLogger).child({
      component: "runtime_bootstrap_startup_coordinator",
      conversationId: this.conversationId,
      runtimeInstanceId: this.runtimeInstanceId,
    });
  }

  start(bootstrap: ConversationRuntimeBootstrap): Promise<RuntimeBootstrapStartupResult> {
    return this.serialize(async () => {
      if (this.started) {
        throw this.fail(RUNTIME_BOOTSTRAP_STARTUP_FAILURE.alreadyStarted);
      }
      let identity: CapturedBootstrapIdentity;
      try {
        identity = captureBootstrapIdentity(
          bootstrap,
          this.conversationId,
          this.runtimeInstanceId,
        );
      } catch {
        throw this.fail(RUNTIME_BOOTSTRAP_STARTUP_FAILURE.invalidBootstrap);
      }
      this.started = true;
      this.logger.info("runtime.bootstrap.startup_started", {
        activationReason: identity.activationReason,
        throughSequence: identity.throughSequence,
      });

      let replay: RuntimeReplayPlan;
      try {
        replay = await this.replayPlanner.plan({
          conversationId: this.conversationId,
          throughSequence: identity.throughSequence,
        });
        if (
          replay.conversationId !== this.conversationId ||
          replay.throughSequence !== identity.throughSequence ||
          !Number.isSafeInteger(replay.scannedEventCount) ||
          replay.scannedEventCount < 0 ||
          !Number.isSafeInteger(replay.processedInputCount) ||
          replay.processedInputCount < 0
        ) {
          throw new TypeError("Replay identity mismatch");
        }
      } catch {
        throw this.fail(RUNTIME_BOOTSTRAP_STARTUP_FAILURE.replayFailed);
      }

      let startupPlan: RuntimeStartupPlan;
      try {
        startupPlan = this.startupReconciler.reconcile(replay);
      } catch {
        throw this.fail(RUNTIME_BOOTSTRAP_STARTUP_FAILURE.reconcileFailed);
      }
      if (
        startupPlan.lifecycleDisposition !==
          RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.ready &&
        startupPlan.lifecycleDisposition !==
          RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.recoveryRequired
      ) {
        throw this.fail(RUNTIME_BOOTSTRAP_STARTUP_FAILURE.reconcileFailed);
      }

      let execution: RuntimeStartupExecutionResult;
      try {
        execution = await this.startupExecutor.execute(startupPlan);
        if (
          execution.conversationId !== this.conversationId ||
          execution.throughSequence !== identity.throughSequence
        ) {
          throw new TypeError("Startup execution identity mismatch");
        }
      } catch {
        throw this.fail(RUNTIME_BOOTSTRAP_STARTUP_FAILURE.executionFailed);
      }

      if (this.orphanedApprovalSettler !== undefined) {
        try {
          await this.orphanedApprovalSettler(this.conversationId);
        } catch (error) {
          // best-effort：结算失败不阻塞启动；遗留审批下次启动仍可补结。
          this.logger.warn("runtime.bootstrap.orphaned_approval_settlement_failed", {
            error: captureStableFailure(error),
          });
        }
      }

      const result = Object.freeze({
        conversationId: this.conversationId,
        runtimeInstanceId: this.runtimeInstanceId,
        activationReason: identity.activationReason,
        throughSequence: identity.throughSequence,
        scannedEventCount: replay.scannedEventCount,
        processedInputCount: replay.processedInputCount,
        outcomeRepairCount: execution.repairCommits.length,
        routedInputCount: execution.routeResults.length,
        ...(startupPlan.run !== undefined
          ? {
              restoredRunId: startupPlan.run.runId,
              restoredRunStatus: startupPlan.run.status,
            }
          : {}),
        ...(startupPlan.turn !== undefined
          ? {
              restoredTurnId: startupPlan.turn.turnId,
              restoredTurnStatus: startupPlan.turn.status,
            }
          : {}),
      });
      this.logger.info("runtime.bootstrap.startup_completed", {
        activationReason: result.activationReason,
        throughSequence: result.throughSequence,
        scannedEventCount: result.scannedEventCount,
        processedInputCount: result.processedInputCount,
        outcomeRepairCount: result.outcomeRepairCount,
        routedInputCount: result.routedInputCount,
        ...(result.restoredRunId !== undefined
          ? {
              restoredRunId: result.restoredRunId,
              restoredRunStatus: result.restoredRunStatus,
            }
          : {}),
        ...(result.restoredTurnId !== undefined
          ? {
              restoredTurnId: result.restoredTurnId,
              restoredTurnStatus: result.restoredTurnStatus,
            }
          : {}),
      });
      return result;
    });
  }

  private fail(failure: RuntimeBootstrapStartupFailure): RuntimeBootstrapStartupError {
    this.logger.error("runtime.bootstrap.startup_failed", { failure });
    return new RuntimeBootstrapStartupError(
      this.conversationId,
      this.runtimeInstanceId,
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

interface CapturedBootstrapIdentity {
  readonly activationReason: ConversationRuntimeActivationReason;
  readonly throughSequence: number;
}

function captureBootstrapIdentity(
  bootstrap: ConversationRuntimeBootstrap,
  conversationId: string,
  runtimeInstanceId: string,
): CapturedBootstrapIdentity {
  if (
    bootstrap === null ||
    typeof bootstrap !== "object" ||
    bootstrap.schemaVersion !== CONVERSATION_RUNTIME_BOOTSTRAP_SCHEMA_VERSION ||
    bootstrap.runtimeInstanceId !== runtimeInstanceId ||
    Number.isNaN(Date.parse(bootstrap.activatedAt)) ||
    bootstrap.conversation?.metadata?.id !== conversationId ||
    bootstrap.conversation.metadata.status !== "active" ||
    bootstrap.conversation.activeAgentBinding?.conversationId !== conversationId ||
    bootstrap.conversation.activeAgentBinding.status !== "active" ||
    bootstrap.conversation.metadata.workspaceId !== bootstrap.workspace?.workspaceId ||
    typeof bootstrap.workspace.workspaceId !== "string" ||
    bootstrap.workspace.workspaceId.trim().length === 0 ||
    typeof bootstrap.workspace.workdir !== "string" ||
    bootstrap.workspace.workdir.trim().length === 0 ||
    !Number.isSafeInteger(bootstrap.journal?.highWatermark) ||
    bootstrap.journal.highWatermark < 0 ||
    !Number.isSafeInteger(bootstrap.conversation.metadata.lastJournalSequence) ||
    bootstrap.conversation.metadata.lastJournalSequence < 0 ||
    bootstrap.conversation.metadata.lastJournalSequence > bootstrap.journal.highWatermark ||
    typeof bootstrap.conversation.activeAgentBinding.agentType !== "string" ||
    bootstrap.conversation.activeAgentBinding.agentType.trim().length === 0 ||
    typeof bootstrap.conversation.activeAgentBinding.definitionVersion !== "string" ||
    bootstrap.conversation.activeAgentBinding.definitionVersion.trim().length === 0
  ) {
    throw new TypeError("Runtime Bootstrap identity is invalid");
  }

  const activation = bootstrap.activation;
  if (activation === null || typeof activation !== "object") {
    throw new TypeError("Runtime Bootstrap activation is invalid");
  }
  if (activation.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput) {
    if (
      activation.input?.conversationId !== conversationId ||
      typeof activation.input.inputEventId !== "string" ||
      activation.input.inputEventId.trim().length === 0 ||
      !isEventType(activation.input.eventType) ||
      !Number.isSafeInteger(activation.input.sequence) ||
      activation.input.sequence < 1 ||
      activation.input.sequence > bootstrap.journal.highWatermark ||
      !isOptionalIdentifier(activation.input.correlationId) ||
      !isOptionalIdentifier(activation.input.runId) ||
      !isOptionalIdentifier(activation.input.turnId) ||
      (activation.input.turnId !== undefined && activation.input.runId === undefined)
    ) {
      throw new TypeError("Runtime Bootstrap activation Input is invalid");
    }
  } else if (
    activation.reason !== CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore &&
    activation.reason !== CONVERSATION_RUNTIME_ACTIVATION_REASON.crashRecovery
  ) {
    throw new TypeError("Runtime Bootstrap activation reason is invalid");
  } else if ("input" in activation) {
    throw new TypeError("Runtime Bootstrap activation Input is unexpected");
  }

  return Object.freeze({
    activationReason: activation.reason,
    throughSequence: bootstrap.journal.highWatermark,
  });
}

function isOptionalIdentifier(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.trim().length > 0);
}

function assertNonBlank(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RuntimeBootstrapStartupError(
      "unknown",
      "unknown",
      RUNTIME_BOOTSTRAP_STARTUP_FAILURE.invalidBootstrap,
    );
  }
}

function captureStableFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    return error.name;
  }
  return "unknown";
}
