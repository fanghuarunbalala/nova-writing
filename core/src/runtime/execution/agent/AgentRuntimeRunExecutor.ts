/**
 * 协调一次已认领的 Core Run：准备 → 组装（base + 消息）→ Agent 执行 → 持久化优先的终结。
 * Coordinates one claimed Core Run through preparation, assembly (base + messages),
 * Agent execution, and persistence-first normal Run terminalization.
 */
import {
  canonicalStringifyJson,
  isAgentTurnInputEventType,
  type JsonValue,
} from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PersistedInputEventSnapshot } from "../../../storage/index.js";
import {
  AGENT_RUNTIME_INVOCATION_KIND,
  AGENT_RUNTIME_OUTCOME,
  type AgentRuntimeAdapter,
  type AgentRuntimeInvocation,
  type AgentRuntimeStreamResult,
} from "../../agent/index.js";
import type {
  CompiledProviderContext,
  RuntimePromptAssembler,
} from "../../context/index.js";
import type { PromptBase } from "../../../prompt/index.js";
import {
  coreRuntimeMessageSchemaRegistry,
  type RuntimeMessageSchemaRegistry,
  type RuntimeMessageSnapshot,
} from "../../message/index.js";
import { RUN_STATE_CHANGE_REASON, RUN_STATUS } from "../RunLifecycle.js";
import type {
  LifecycleEventMetadata,
  RunLifecycleCommit,
} from "../control/TurnController.js";
import type {
  RuntimeRunExecutionRequest,
  RuntimeRunExecutor,
} from "../control/RuntimeUserMessageInputHandler.js";
import type { RunStateSnapshot } from "../state/RunStateMachine.js";
import {
  AGENT_RUNTIME_RUN_EXECUTION_FAILURE,
  AgentRuntimeRunExecutorError,
  type AgentRuntimeRunExecutionFailure,
} from "./AgentRuntimeRunExecutorErrors.js";
import type {
  RuntimeRunPreparation,
  RuntimeRunPreparationSource,
} from "./RuntimeRunPreparationSource.js";

export interface AgentRuntimeRunLifecycleController {
  getRunSnapshot(): RunStateSnapshot | undefined;
  waitForRunTerminal(runId: string): Promise<RunStateSnapshot>;
  transitionRun(
    request:
      | { current: "completed"; reason: "execution_completed" }
      | { current: "failed"; reason: "execution_failed" },
    metadata?: LifecycleEventMetadata,
  ): Promise<RunLifecycleCommit>;
}

export interface AgentRuntimeRunExecutorOptions {
  conversationId: string;
  preparationSource: RuntimeRunPreparationSource;
  assembler: RuntimePromptAssembler;
  agentAdapter: AgentRuntimeAdapter;
  lifecycleController: AgentRuntimeRunLifecycleController;
  messageSchemaRegistry?: RuntimeMessageSchemaRegistry;
  logger?: Logger;
}

interface CapturedRuntimeRunPreparation {
  readonly conversationId: string;
  readonly runId: string;
  readonly basePrompt: PromptBase;
  readonly messageHighWatermark: number;
  readonly contextMessages: readonly RuntimeMessageSnapshot[];
  readonly invocation: AgentRuntimeInvocation;
}

export class AgentRuntimeRunExecutor implements RuntimeRunExecutor {
  private readonly conversationId: string;
  private readonly preparationSource: RuntimeRunPreparationSource;
  private readonly assembler: RuntimePromptAssembler;
  private readonly agentAdapter: AgentRuntimeAdapter;
  private readonly lifecycleController: AgentRuntimeRunLifecycleController;
  private readonly messageSchemaRegistry: RuntimeMessageSchemaRegistry;
  private readonly logger: Logger;
  private activeRunId?: string;

  constructor(options: AgentRuntimeRunExecutorOptions) {
    assertNonBlank("Conversation ID", options.conversationId);
    this.conversationId = options.conversationId;
    this.preparationSource = options.preparationSource;
    this.assembler = options.assembler;
    this.agentAdapter = options.agentAdapter;
    this.lifecycleController = options.lifecycleController;
    this.messageSchemaRegistry =
      options.messageSchemaRegistry ?? coreRuntimeMessageSchemaRegistry;
    this.logger = (options.logger ?? noopLogger).child({
      component: "agent_runtime_run_executor",
      conversationId: this.conversationId,
    });
  }

  execute(request: RuntimeRunExecutionRequest): Promise<void> {
    let captured: RuntimeRunExecutionRequest;
    try {
      captured = captureExecutionRequest(request, this.conversationId);
    } catch {
      return Promise.reject(
        this.fail(AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidRequest),
      );
    }
    if (this.activeRunId !== undefined) {
      return Promise.reject(
        this.fail(
          AGENT_RUNTIME_RUN_EXECUTION_FAILURE.activeExecution,
          captured.runId,
        ),
      );
    }

    this.activeRunId = captured.runId;
    return this.executeCaptured(captured).finally(() => {
      if (this.activeRunId === captured.runId) this.activeRunId = undefined;
    });
  }

  private async executeCaptured(request: RuntimeRunExecutionRequest): Promise<void> {
    this.assertRunningRun(request);
    this.logger.info("runtime.agent_run.execution_started", toLogIdentity(request));

    const preparation = await this.prepare(request);
    this.logger.debug("runtime.agent_run.preparation_completed", {
      ...toLogIdentity(request),
      invocationKind: preparation.invocation.kind,
      contextMessageCount: preparation.contextMessages.length,
      promptMessageCount:
        preparation.invocation.kind === AGENT_RUNTIME_INVOCATION_KIND.prompt
          ? preparation.invocation.messages.length
          : 0,
    });

    const context = await this.compileContext(preparation, request);
    if (await this.deferToCancellationIfOwned(request, "preparing")) return;
    let result: AgentRuntimeStreamResult;
    try {
      result = await this.streamAgent(preparation.invocation, context, request);
    } catch (error) {
      // Safety net: an adapter failure while the stop path owns the run
      // (stopping/cancelled) is a shutdown artifact, not a real execution error —
      // settle through the existing cancellation terminal wait instead of crashing.
      const current = this.lifecycleController.getRunSnapshot();
      if (isCancellationOwnedState(current, request.runId)) {
        await this.waitForCancellationTerminal(request);
        return;
      }
      throw error;
    }
    this.logger.info("runtime.agent_run.adapter_settled", {
      ...toLogIdentity(request),
      outcome: result.outcome,
    });

    const current = this.lifecycleController.getRunSnapshot();
    if (isCancellationOwnedState(current, request.runId)) {
      await this.waitForCancellationTerminal(request, result.outcome);
      return;
    }
    if (result.outcome === AGENT_RUNTIME_OUTCOME.cancelled) {
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidCancellationState,
        request.runId,
        request,
      );
    }
    if (!isMatchingRunningRun(current, request)) {
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidRunState,
        request.runId,
        request,
      );
    }

    const target =
      result.outcome === AGENT_RUNTIME_OUTCOME.completed
        ? {
            current: RUN_STATUS.completed,
            reason: RUN_STATE_CHANGE_REASON.executionCompleted,
          }
        : {
            current: RUN_STATUS.failed,
            reason: RUN_STATE_CHANGE_REASON.executionFailed,
          };
    let commit: RunLifecycleCommit;
    try {
      commit = await this.lifecycleController.transitionRun(
        target,
        captureLifecycleMetadata(request.input),
      );
    } catch {
      const racedState = this.lifecycleController.getRunSnapshot();
      if (isCancellationOwnedState(racedState, request.runId)) {
        await this.waitForCancellationTerminal(request, result.outcome);
        return;
      }
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.terminalTransitionFailed,
        request.runId,
        request,
      );
    }
    if (!isMatchingTerminalCommit(commit, request.runId, target)) {
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidTerminalCommit,
        request.runId,
        request,
      );
    }
    this.logger.info("runtime.agent_run.execution_completed", {
      ...toLogIdentity(request),
      runStatus: target.current,
      receiptSequence: commit.receipt.sequence,
    });
  }

  private async prepare(
    request: RuntimeRunExecutionRequest,
  ): Promise<CapturedRuntimeRunPreparation> {
    let preparation: RuntimeRunPreparation;
    try {
      preparation = await this.preparationSource.prepare(request);
    } catch {
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.preparationFailed,
        request.runId,
        request,
      );
    }
    try {
      return capturePreparation(
        preparation,
        request,
        this.messageSchemaRegistry,
      );
    } catch {
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidPreparation,
        request.runId,
        request,
      );
    }
  }

  private async compileContext(
    preparation: CapturedRuntimeRunPreparation,
    request: RuntimeRunExecutionRequest,
  ): Promise<CompiledProviderContext> {
    let context: CompiledProviderContext;
    try {
      const assembly = await this.assembler.assemble({
        conversationId: request.conversationId,
        runId: request.runId,
        basePrompt: preparation.basePrompt,
        messages: preparation.contextMessages,
        messageHighWatermark: preparation.messageHighWatermark,
      });
      context = {
        conversationId: request.conversationId,
        runId: request.runId,
        systemPrompt: assembly.systemPrompt,
        messages: assembly.messages,
      };
    } catch {
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.assemblyFailed,
        request.runId,
        request,
      );
    }
    if (
      context?.conversationId !== request.conversationId ||
      context.runId !== request.runId ||
      typeof context.systemPrompt !== "string" ||
      !Array.isArray(context.messages)
    ) {
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidCompiledContext,
        request.runId,
        request,
      );
    }
    try {
      return captureCompiledContext(
        context,
        request,
        preparation.invocation,
        this.messageSchemaRegistry,
      );
    } catch {
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidCompiledContext,
        request.runId,
        request,
      );
    }
  }

  private async streamAgent(
    invocation: AgentRuntimeInvocation,
    context: CompiledProviderContext,
    request: RuntimeRunExecutionRequest,
  ): Promise<AgentRuntimeStreamResult> {
    let result: AgentRuntimeStreamResult;
    try {
      result = await this.agentAdapter.stream({
        conversationId: request.conversationId,
        runId: request.runId,
        context,
        invocation,
      });
    } catch {
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.adapterFailed,
        request.runId,
        request,
      );
    }
    if (
      result?.conversationId !== request.conversationId ||
      result.runId !== request.runId ||
      !Object.values(AGENT_RUNTIME_OUTCOME).includes(result.outcome)
    ) {
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidAdapterResult,
        request.runId,
        request,
      );
    }
    return Object.freeze({
      conversationId: request.conversationId,
      runId: request.runId,
      outcome: result.outcome,
    });
  }

  private assertRunningRun(request: RuntimeRunExecutionRequest): void {
    if (!isMatchingRunningRun(this.lifecycleController.getRunSnapshot(), request)) {
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidRunState,
        request.runId,
        request,
      );
    }
  }

  private async deferToCancellationIfOwned(
    request: RuntimeRunExecutionRequest,
    phase: "preparing",
  ): Promise<boolean> {
    const snapshot = this.lifecycleController.getRunSnapshot();
    if (!isCancellationOwnedState(snapshot, request.runId)) {
      if (!isMatchingRunningRun(snapshot, request)) {
        throw this.fail(
          AGENT_RUNTIME_RUN_EXECUTION_FAILURE.invalidRunState,
          request.runId,
          request,
        );
      }
      return false;
    }
    await this.waitForCancellationTerminal(request, undefined, phase);
    return true;
  }

  private async waitForCancellationTerminal(
    request: RuntimeRunExecutionRequest,
    outcome?: AgentRuntimeStreamResult["outcome"],
    phase?: "preparing",
  ): Promise<void> {
    let terminal: RunStateSnapshot;
    try {
      terminal = await this.lifecycleController.waitForRunTerminal(request.runId);
    } catch {
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.cancellationSettlementFailed,
        request.runId,
        request,
      );
    }
    if (
      terminal.runId !== request.runId ||
      (terminal.status !== RUN_STATUS.cancelled && terminal.status !== RUN_STATUS.failed)
    ) {
      throw this.fail(
        AGENT_RUNTIME_RUN_EXECUTION_FAILURE.cancellationSettlementFailed,
        request.runId,
        request,
      );
    }
    this.logger.info("runtime.agent_run.terminalization_deferred", {
      ...toLogIdentity(request),
      ...(outcome !== undefined ? { outcome } : {}),
      ...(phase !== undefined ? { phase } : {}),
      runStatus: terminal.status,
    });
  }

  private fail(
    failure: AgentRuntimeRunExecutionFailure,
    runId?: string,
    request?: RuntimeRunExecutionRequest,
  ): AgentRuntimeRunExecutorError {
    this.logger.error("runtime.agent_run.execution_failed", {
      failure,
      ...(request !== undefined ? toLogIdentity(request) : {}),
      ...(request === undefined && runId !== undefined ? { runId } : {}),
    });
    return new AgentRuntimeRunExecutorError(this.conversationId, runId, failure);
  }
}

function captureExecutionRequest(
  request: RuntimeRunExecutionRequest,
  conversationId: string,
): RuntimeRunExecutionRequest {
  if (
    request === null ||
    typeof request !== "object" ||
    request.conversationId !== conversationId ||
    captureNonBlank(request.runId) === undefined ||
    request.input === null ||
    typeof request.input !== "object" ||
    request.input.direction !== "input" ||
    request.input.conversationId !== conversationId ||
    !isAgentTurnInputEventType(request.input.eventType) ||
    captureNonBlank(request.input.id) === undefined ||
    !Number.isSafeInteger(request.input.sequence) ||
    request.input.sequence <= 0
  ) {
    throw new TypeError("Runtime Run execution request is invalid");
  }
  return deepFreezeJson(
    JSON.parse(canonicalStringifyJson(request as unknown as JsonValue)),
  ) as RuntimeRunExecutionRequest;
}

function capturePreparation(
  preparation: RuntimeRunPreparation,
  request: RuntimeRunExecutionRequest,
  registry: RuntimeMessageSchemaRegistry,
): CapturedRuntimeRunPreparation {
  if (
    preparation === null ||
    typeof preparation !== "object" ||
    preparation.conversationId !== request.conversationId ||
    preparation.runId !== request.runId ||
    preparation.basePrompt === null ||
    typeof preparation.basePrompt !== "object" ||
    typeof preparation.basePrompt.content !== "string" ||
    typeof preparation.basePrompt.digest !== "string" ||
    !Number.isSafeInteger(preparation.messageHighWatermark) ||
    preparation.messageHighWatermark < 0 ||
    !Array.isArray(preparation.contextMessages)
  ) {
    throw new TypeError("Runtime Run preparation is invalid");
  }

  const seenMessageIds = new Set<string>();
  const contextMessages = captureMessages(
    preparation.contextMessages,
    request.conversationId,
    registry,
    seenMessageIds,
  );
  let invocation: AgentRuntimeInvocation;
  if (preparation.invocation?.kind === AGENT_RUNTIME_INVOCATION_KIND.continue) {
    if (contextMessages.length === 0) {
      throw new TypeError("Continue preparation requires context Messages");
    }
    invocation = Object.freeze({ kind: AGENT_RUNTIME_INVOCATION_KIND.continue });
  } else if (preparation.invocation?.kind === AGENT_RUNTIME_INVOCATION_KIND.prompt) {
    if (!Array.isArray(preparation.invocation.messages) || preparation.invocation.messages.length === 0) {
      throw new TypeError("Prompt preparation requires Messages");
    }
    invocation = Object.freeze({
      kind: AGENT_RUNTIME_INVOCATION_KIND.prompt,
      messages: captureMessages(
        preparation.invocation.messages,
        request.conversationId,
        registry,
        seenMessageIds,
      ),
    });
  } else {
    throw new TypeError("Runtime Run invocation is invalid");
  }

  return Object.freeze({
    conversationId: request.conversationId,
    runId: request.runId,
    basePrompt: preparation.basePrompt,
    messageHighWatermark: preparation.messageHighWatermark,
    contextMessages,
    invocation,
  });
}

function captureMessages(
  messages: readonly RuntimeMessageSnapshot[],
  conversationId: string,
  registry: RuntimeMessageSchemaRegistry,
  seenMessageIds: Set<string>,
): readonly RuntimeMessageSnapshot[] {
  const captured = messages.map((message) => {
    const clone = JSON.parse(
      canonicalStringifyJson(message as unknown as JsonValue),
    ) as RuntimeMessageSnapshot;
    const validated = registry.validateSnapshot(clone);
    if (
      validated.conversationId !== conversationId ||
      seenMessageIds.has(validated.id)
    ) {
      throw new TypeError("Runtime Message identity is invalid");
    }
    seenMessageIds.add(validated.id);
    return deepFreezeJson(clone);
  });
  return Object.freeze(captured);
}

function captureCompiledContext(
  context: CompiledProviderContext,
  request: RuntimeRunExecutionRequest,
  invocation: AgentRuntimeInvocation,
  registry: RuntimeMessageSchemaRegistry,
): CompiledProviderContext {
  const seenMessageIds = new Set<string>();
  if (invocation.kind === AGENT_RUNTIME_INVOCATION_KIND.prompt) {
    for (const message of invocation.messages) seenMessageIds.add(message.id);
  }
  return Object.freeze({
    conversationId: request.conversationId,
    runId: request.runId,
    systemPrompt: context.systemPrompt,
    messages: captureMessages(
      context.messages,
      request.conversationId,
      registry,
      seenMessageIds,
    ),
  });
}

function isMatchingRunningRun(
  snapshot: RunStateSnapshot | undefined,
  request: RuntimeRunExecutionRequest,
): snapshot is RunStateSnapshot & { readonly status: "running" } {
  return (
    snapshot?.runId === request.runId &&
    snapshot.status === RUN_STATUS.running &&
    snapshot.inputEvent.id === request.input.id &&
    snapshot.inputEvent.eventType === request.input.eventType &&
    snapshot.inputEvent.sequence === request.input.sequence
  );
}

function isCancellationOwnedState(
  snapshot: RunStateSnapshot | undefined,
  runId: string,
): snapshot is RunStateSnapshot & { readonly status: "stopping" | "cancelled" } {
  return (
    snapshot?.runId === runId &&
    (snapshot.status === RUN_STATUS.stopping || snapshot.status === RUN_STATUS.cancelled)
  );
}

function isMatchingTerminalCommit(
  commit: unknown,
  runId: string,
  target: { readonly current: "completed" | "failed"; readonly reason: string },
): boolean {
  if (commit === null || typeof commit !== "object" || Array.isArray(commit)) {
    return false;
  }
  const candidate = commit as Partial<RunLifecycleCommit>;
  return (
    candidate.scope === "run" &&
    candidate.transition?.runId === runId &&
    candidate.transition.current === target.current &&
    candidate.transition.reason === target.reason &&
    Number.isSafeInteger(candidate.receipt?.sequence) &&
    (candidate.receipt?.sequence ?? 0) > 0
  );
}

function captureLifecycleMetadata(input: PersistedInputEventSnapshot): LifecycleEventMetadata {
  return Object.freeze({
    ...(input.correlationId !== undefined
      ? { correlationId: input.correlationId }
      : {}),
    causationId: input.id,
  });
}

function toLogIdentity(request: RuntimeRunExecutionRequest): Readonly<{
  runId: string;
  inputEventId: string;
  eventType: string;
  sequence: number;
}> {
  return {
    runId: request.runId,
    inputEventId: request.input.id,
    eventType: request.input.eventType,
    sequence: request.input.sequence,
  };
}

function deepFreezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function assertNonBlank(label: string, value: string): void {
  if (captureNonBlank(value) === undefined) {
    throw new TypeError(`${label} must not be blank`);
  }
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
