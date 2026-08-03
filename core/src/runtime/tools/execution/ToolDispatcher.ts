/** Validated Tool execution pipeline and its public Dispatcher facade. */
import {
  canonicalStringifyJson,
  type JsonValue,
} from "../../../event/protocol/index.js";
import type { Logger } from "../../../observability/index.js";
import { noopLogger } from "../../../observability/index.js";
import type { InteractionCoordinator } from "../../interaction/ToolApprovalInteractionProtocol.js";
import type { ToolApprovalRequest } from "../../interaction/ToolApprovalInteractionProtocol.js";
import type { RegisteredTool } from "../../../tooling/protocol/RegisteredTool.js";
import { isToolName } from "../../../tooling/protocol/ToolName.js";
import type {
  ToolExecutionUpdate,
  ToolProgressSink,
} from "../../../tooling/protocol/ToolProgress.js";
import { noopToolProgressSink } from "../../../tooling/protocol/ToolProgress.js";
import type { ToolResult, ToolResultLimits } from "../../../tooling/protocol/ToolResult.js";
import {
  captureToolArguments,
  captureToolExecutionUpdate,
  captureToolResult,
} from "../../../tooling/protocol/ToolProtocolValidator.js";
import { ToolProtocolError } from "../../../tooling/protocol/ToolProtocolErrors.js";
import type { ToolRegistryView } from "../../../tooling/registry/ToolRegistryView.js";
import type {
  CapturedToolInvocation,
  ToolApprovalIdentity,
  ToolArgumentDigester,
  ToolExecutionPolicy,
  ToolInvocation,
  ToolPermissionDecision,
  ToolSideEffectStatus,
  ToolTraceRecord,
  ToolTraceStage,
} from "./ToolExecutionContracts.js";
import { ToolError } from "./ToolExecutionError.js";
import {
  captureToolApprovalIdentity,
  captureToolInvocation,
  captureToolPermissionDecision,
} from "./ToolExecutionProtocolValidator.js";
import type { ToolExecutionPolicyResolver } from "./ToolExecutionPolicyResolver.js";
import type { ToolPermissionPolicy } from "./ToolPermissionPolicy.js";
import type { SandboxExecutor } from "./SandboxExecutor.js";
import type { ToolTraceSink } from "./ToolTraceSink.js";

export interface ToolApprovalRequestFactoryInput {
  readonly identity: ToolApprovalIdentity;
  readonly turnId?: string;
  readonly toolLabel: string;
  readonly toolDescription: string;
}

export interface ToolApprovalRequestFactory {
  create(input: ToolApprovalRequestFactoryInput): ToolApprovalRequest;
}

export interface ToolDispatchOptions {
  readonly signal: AbortSignal;
  readonly progress?: ToolProgressSink;
}

export interface ToolExecutionClock {
  now(): string;
}

export interface ToolExecutionTimer {
  schedule(delayMs: number, callback: () => void): () => void;
}

export interface ToolTraceIdFactory {
  create(invocation: CapturedToolInvocation): string;
}

export const TOOL_CANCEL_OUTCOME = {
  cancelled: "cancelled",
  alreadyCancelled: "already_cancelled",
  notFound: "not_found",
} as const;

export type ToolCancelOutcome =
  (typeof TOOL_CANCEL_OUTCOME)[keyof typeof TOOL_CANCEL_OUTCOME];

export interface ToolCancelResult {
  readonly toolCallId: string;
  readonly outcome: ToolCancelOutcome;
}

export interface ToolExecutionPipelineOptions {
  readonly registryView: ToolRegistryView;
  readonly argumentDigester: ToolArgumentDigester;
  readonly executionPolicyResolver: ToolExecutionPolicyResolver;
  readonly permissionPolicy: ToolPermissionPolicy;
  readonly interactionCoordinator: InteractionCoordinator;
  readonly approvalRequestFactory: ToolApprovalRequestFactory;
  readonly sandboxExecutor: SandboxExecutor;
  readonly resultLimits: ToolResultLimits;
  readonly traceSink: ToolTraceSink;
  readonly clock?: ToolExecutionClock;
  readonly timer?: ToolExecutionTimer;
  readonly traceIdFactory?: ToolTraceIdFactory;
  readonly logger?: Logger;
}

interface ActiveToolCall {
  readonly invocation: CapturedToolInvocation;
  readonly traceId: string;
  readonly controller: AbortController;
  readonly externalSignal: AbortSignal;
  readonly removeExternalAbort: () => void;
  approvalRequestId?: string;
  tool?: RegisteredTool;
  terminalTraceRecorded: boolean;
}

export class ToolExecutionPipeline {
  readonly #registryView: ToolRegistryView;
  readonly #argumentDigester: ToolArgumentDigester;
  readonly #executionPolicyResolver: ToolExecutionPolicyResolver;
  readonly #permissionPolicy: ToolPermissionPolicy;
  readonly #interactionCoordinator: InteractionCoordinator;
  readonly #approvalRequestFactory: ToolApprovalRequestFactory;
  readonly #sandboxExecutor: SandboxExecutor;
  readonly #resultLimits: ToolResultLimits;
  readonly #traceSink: ToolTraceSink;
  readonly #clock: ToolExecutionClock;
  readonly #timer: ToolExecutionTimer;
  readonly #traceIdFactory: ToolTraceIdFactory;
  readonly #logger: Logger;
  readonly #active = new Map<string, ActiveToolCall>();

  constructor(options: ToolExecutionPipelineOptions) {
    this.#registryView = options.registryView;
    this.#argumentDigester = options.argumentDigester;
    this.#executionPolicyResolver = options.executionPolicyResolver;
    this.#permissionPolicy = options.permissionPolicy;
    this.#interactionCoordinator = options.interactionCoordinator;
    this.#approvalRequestFactory = options.approvalRequestFactory;
    this.#sandboxExecutor = options.sandboxExecutor;
    this.#resultLimits = captureResultLimits(options.resultLimits);
    this.#traceSink = options.traceSink;
    this.#clock = options.clock ?? SYSTEM_TOOL_EXECUTION_CLOCK;
    this.#timer = options.timer ?? SYSTEM_TOOL_EXECUTION_TIMER;
    this.#traceIdFactory = options.traceIdFactory ?? DEFAULT_TOOL_TRACE_ID_FACTORY;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "tool_execution_pipeline",
    });
  }

  async execute(
    invocationSource: ToolInvocation,
    options: ToolDispatchOptions,
  ): Promise<ToolResult> {
    let invocation: CapturedToolInvocation;
    try {
      invocation = await captureToolInvocation(
        invocationSource,
        this.#argumentDigester,
      );
    } catch {
      throw validationError(invocationSource);
    }
    const externalSignal = captureSignal(options?.signal, invocation);
    const active = this.#activate(invocation, externalSignal);
    this.#logger.info("runtime.tool.execution_started", logIdentity(invocation));

    try {
      if (active.controller.signal.aborted) throw cancelledError(invocation, "none");
      const tool = resolveTool(this.#registryView, invocation);
      active.tool = tool;
      const executionPolicy = this.#executionPolicyResolver.resolve(tool);
      const arguments_ = captureArguments(tool, invocation);
      await this.#trace(active, tool, "received", 1, {
        inputBytes: byteLength(invocation.arguments),
      });
      await this.#trace(active, tool, "resolved", 1);
      await this.#trace(active, tool, "validated", 1);
      const permission = this.#evaluatePermission(
        invocation,
        tool,
        executionPolicy,
      );
      await this.#trace(active, tool, "permission_evaluated", 1, {
        ruleIds: permission.ruleIds,
        permissionEffect: permission.effect,
      });
      await this.#authorize(active, tool, executionPolicy, permission);
      assertSandboxCapability(this.#sandboxExecutor, executionPolicy, invocation, tool);
      if (active.controller.signal.aborted) throw cancelledError(invocation, "none", tool);

      const progress = createValidatedProgressSink(
        options.progress ?? noopToolProgressSink,
        invocation,
        tool,
      );
      const result = await this.#executeSandbox(
        active,
        tool,
        executionPolicy,
        arguments_,
        progress,
      );
      this.#logger.info("runtime.tool.execution_completed", {
        ...logIdentity(invocation, tool),
        resultBlockCount: result.content.length,
        artifactCount: result.artifacts?.length ?? 0,
      });
      return result;
    } catch (error) {
      const normalized = normalizeToolFailure(error, invocation);
      if (!active.terminalTraceRecorded && active.tool) {
        const stage = normalized.category === "cancelled"
          ? "cancelled"
          : normalized.category === "timeout"
            ? "timed_out"
            : "execution_failed";
        await this.#trace(active, active.tool, stage, 1, {
          errorCategory: normalized.category,
          errorCode: normalized.code,
          retryable: normalized.retryable,
          sideEffectStatus: normalized.sideEffectStatus,
        });
        active.terminalTraceRecorded = true;
      }
      this.#logger.info("runtime.tool.execution_failed", {
        ...logIdentity(invocation),
        errorCode: normalized.code,
        errorCategory: normalized.category,
        retryable: normalized.retryable,
        sideEffectStatus: normalized.sideEffectStatus,
      });
      throw normalized;
    } finally {
      this.#deactivate(active);
    }
  }

  async cancel(toolCallIdSource: string): Promise<ToolCancelResult> {
    const toolCallId = safeIdentity(toolCallIdSource);
    if (!toolCallId) {
      return Object.freeze({
        toolCallId: "unknown",
        outcome: TOOL_CANCEL_OUTCOME.notFound,
      });
    }
    const active = this.#active.get(toolCallId);
    if (!active) {
      return Object.freeze({ toolCallId, outcome: TOOL_CANCEL_OUTCOME.notFound });
    }
    if (active.controller.signal.aborted) {
      return Object.freeze({
        toolCallId,
        outcome: TOOL_CANCEL_OUTCOME.alreadyCancelled,
      });
    }
    active.controller.abort();
    if (active.approvalRequestId) {
      try {
        await this.#interactionCoordinator.cancel(
          active.approvalRequestId,
          this.#timestamp(),
        );
      } catch {
        throw internalError(
          "TOOL_APPROVAL_CANCELLATION_FAILED",
          active.invocation,
          active.tool,
        );
      }
    }
    this.#logger.info("runtime.tool.cancel_requested", logIdentity(
      active.invocation,
      active.tool,
    ));
    return Object.freeze({ toolCallId, outcome: TOOL_CANCEL_OUTCOME.cancelled });
  }

  #evaluatePermission(
    invocation: CapturedToolInvocation,
    tool: RegisteredTool,
    executionPolicy: ToolExecutionPolicy,
  ): ToolPermissionDecision {
    try {
      return captureToolPermissionDecision(this.#permissionPolicy.evaluate({
        invocation,
        toolVersion: tool.descriptor.version,
        executionPolicy,
      }));
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw internalError("TOOL_PERMISSION_EVALUATION_FAILED", invocation, tool);
    }
  }

  async #authorize(
    active: ActiveToolCall,
    tool: RegisteredTool,
    executionPolicy: ToolExecutionPolicy,
    permission: ToolPermissionDecision,
  ): Promise<void> {
    const invocation = active.invocation;
    this.#logger.debug("runtime.tool.permission_evaluated", {
      ...logIdentity(invocation, tool),
      effect: permission.effect,
      hardRestriction: permission.hardRestriction,
      ruleCount: permission.ruleIds.length,
    });
    if (permission.effect === "deny") {
      throw new ToolError({
        code: "TOOL_PERMISSION_DENIED",
        category: "permission",
        sideEffectStatus: "none",
        ...errorIdentity(invocation, tool),
      });
    }
    if (permission.effect === "allow") return;
    if (active.controller.signal.aborted) {
      throw cancelledError(invocation, "none", tool);
    }

    const identity = approvalIdentity(invocation, tool);
    let request: ToolApprovalRequest;
    try {
      request = this.#approvalRequestFactory.create({
        identity,
        ...(invocation.turnId === undefined ? {} : { turnId: invocation.turnId }),
        toolLabel: tool.descriptor.label,
        toolDescription: tool.descriptor.description,
      });
      if (!sameApprovalIdentity(request.identity, identity)) throw new Error();
    } catch {
      throw internalError("TOOL_APPROVAL_REQUEST_FAILED", invocation, tool);
    }

    active.approvalRequestId = request.approvalRequestId;
    await this.#trace(active, tool, "approval_requested", 1);
    let resolution;
    try {
      resolution = await this.#interactionCoordinator.request(request);
    } finally {
      active.approvalRequestId = undefined;
    }
    if (!sameApprovalIdentity(resolution.identity, identity)) {
      throw internalError("TOOL_APPROVAL_IDENTITY_MISMATCH", invocation, tool);
    }
    await this.#trace(active, tool, "approval_resolved", 1, {
      approvalDecision: resolution.decision,
      ...(resolution.actorId === undefined
        ? {}
        : { approvalActorId: resolution.actorId }),
    });
    if (resolution.decision === "cancelled") {
      throw cancelledError(invocation, "none", tool);
    }
    if (resolution.decision !== "approved") {
      throw new ToolError({
        code: resolution.decision === "expired"
          ? "TOOL_APPROVAL_EXPIRED"
          : "TOOL_APPROVAL_REJECTED",
        category: "approval_rejected",
        sideEffectStatus: "none",
        ...errorIdentity(invocation, tool),
      });
    }

    let approved: ToolPermissionDecision;
    try {
      approved = captureToolPermissionDecision(this.#permissionPolicy.evaluate({
        invocation,
        toolVersion: tool.descriptor.version,
        executionPolicy,
        approvalGrant: {
          grantId: resolution.approvalRequestId,
          identity: resolution.identity,
        },
      }));
    } catch {
      throw internalError("TOOL_APPROVAL_REEVALUATION_FAILED", invocation, tool);
    }
    if (approved.effect !== "allow") {
      throw new ToolError({
        code: "TOOL_PERMISSION_DENIED_AFTER_APPROVAL",
        category: "permission",
        sideEffectStatus: "none",
        ...errorIdentity(invocation, tool),
      });
    }
  }

  async #executeSandbox(
    active: ActiveToolCall,
    tool: RegisteredTool,
    policy: ToolExecutionPolicy,
    arguments_: JsonValue,
    progress: ToolProgressSink,
  ): Promise<ToolResult> {
    const invocation = active.invocation;
    for (let attempt = 1; attempt <= policy.retry.maximumAttempts; attempt += 1) {
      const startedAt = this.#timestamp();
      await this.#trace(active, tool, "sandbox_started", attempt);
      await this.#trace(active, tool, "execution_started", attempt);
      let timedOut = false;
      const attemptController = new AbortController();
      const forwardCancellation = () => attemptController.abort();
      active.controller.signal.addEventListener("abort", forwardCancellation, {
        once: true,
      });
      if (active.controller.signal.aborted) attemptController.abort();
      const clearTimeout = this.#timer.schedule(policy.timeoutMs, () => {
        timedOut = true;
        attemptController.abort();
      });
      try {
        const rawResult = await this.#sandboxExecutor.execute({
          tool,
          context: Object.freeze({
            conversationId: invocation.conversationId,
            runId: invocation.runId,
            toolCallId: invocation.toolCallId,
            ...(invocation.turnId === undefined ? {} : { turnId: invocation.turnId }),
            signal: attemptController.signal,
          }),
          arguments: arguments_,
          progress,
          policy,
        });
        const result = captureToolResult(rawResult, {
          conversationId: invocation.conversationId,
          toolCallId: invocation.toolCallId,
          toolName: tool.descriptor.name,
          toolVersion: tool.descriptor.version,
          limits: this.#resultLimits,
        });
        await this.#trace(active, tool, "execution_completed", attempt, {
          durationMs: elapsedMs(startedAt, this.#timestamp()),
          outputBytes: byteLength(result as unknown as JsonValue),
          artifactIds: result.artifacts?.map((artifact) => artifact.artifactId),
        });
        active.terminalTraceRecorded = true;
        return result;
      } catch (error) {
        const base = normalizeToolFailure(error, invocation, tool);
        const normalized = timedOut
          ? timeoutError(invocation, base.sideEffectStatus, tool)
          : active.controller.signal.aborted
            ? cancelledError(invocation, base.sideEffectStatus, tool)
            : base;
        const retry = shouldRetry(policy, normalized, attempt);
        await this.#trace(
          active,
          tool,
          normalized.category === "timeout"
            ? "timed_out"
            : normalized.category === "cancelled"
              ? "cancelled"
              : "execution_failed",
          attempt,
          {
            durationMs: elapsedMs(startedAt, this.#timestamp()),
            errorCategory: normalized.category,
            errorCode: normalized.code,
            retryable: normalized.retryable,
            sideEffectStatus: normalized.sideEffectStatus,
          },
        );
        if (!retry) {
          active.terminalTraceRecorded = true;
          throw normalized;
        }
      } finally {
        clearTimeout();
        active.controller.signal.removeEventListener("abort", forwardCancellation);
      }
    }
    throw internalError("TOOL_RETRY_STATE_INVALID", invocation, tool);
  }

  #activate(
    invocation: CapturedToolInvocation,
    externalSignal: AbortSignal,
  ): ActiveToolCall {
    if (this.#active.has(invocation.toolCallId)) {
      throw new ToolError({
        code: "TOOL_CALL_ALREADY_ACTIVE",
        category: "validation",
        sideEffectStatus: "none",
        ...errorIdentity(invocation),
      });
    }
    const controller = new AbortController();
    const forwardExternalAbort = () => controller.abort();
    externalSignal.addEventListener("abort", forwardExternalAbort, { once: true });
    if (externalSignal.aborted) controller.abort();
    const active: ActiveToolCall = {
      invocation,
      traceId: this.#traceIdFactory.create(invocation),
      controller,
      externalSignal,
      removeExternalAbort: () =>
        externalSignal.removeEventListener("abort", forwardExternalAbort),
      terminalTraceRecorded: false,
    };
    this.#active.set(invocation.toolCallId, active);
    return active;
  }

  #deactivate(active: ActiveToolCall): void {
    active.removeExternalAbort();
    if (this.#active.get(active.invocation.toolCallId) === active) {
      this.#active.delete(active.invocation.toolCallId);
    }
  }

  async #trace(
    active: ActiveToolCall,
    tool: RegisteredTool,
    stage: ToolTraceStage,
    attempt: number,
    fields: Partial<ToolTraceRecord> = {},
  ): Promise<void> {
    try {
      await this.#traceSink.append({
        traceId: active.traceId,
        conversationId: active.invocation.conversationId,
        runId: active.invocation.runId,
        toolCallId: active.invocation.toolCallId,
        ...(active.invocation.turnId === undefined
          ? {}
          : { turnId: active.invocation.turnId }),
        toolName: tool.descriptor.name,
        toolVersion: tool.descriptor.version,
        argumentDigest: active.invocation.argumentDigest,
        stage,
        timestamp: this.#timestamp(),
        attempt,
        ...(fields.durationMs === undefined ? {} : { durationMs: fields.durationMs }),
        ...(fields.inputBytes === undefined ? {} : { inputBytes: fields.inputBytes }),
        ...(fields.outputBytes === undefined ? {} : { outputBytes: fields.outputBytes }),
        ...(fields.ruleIds === undefined ? {} : { ruleIds: fields.ruleIds }),
        ...(fields.permissionEffect === undefined
          ? {}
          : { permissionEffect: fields.permissionEffect }),
        ...(fields.approvalDecision === undefined
          ? {}
          : { approvalDecision: fields.approvalDecision }),
        ...(fields.approvalActorId === undefined
          ? {}
          : { approvalActorId: fields.approvalActorId }),
        ...(fields.artifactIds === undefined ? {} : { artifactIds: fields.artifactIds }),
        ...(fields.errorCategory === undefined
          ? {}
          : { errorCategory: fields.errorCategory }),
        ...(fields.errorCode === undefined ? {} : { errorCode: fields.errorCode }),
        ...(fields.retryable === undefined ? {} : { retryable: fields.retryable }),
        ...(fields.sideEffectStatus === undefined
          ? {}
          : { sideEffectStatus: fields.sideEffectStatus }),
      });
    } catch {
      throw new ToolError({
        code: "TOOL_TRACE_PERSIST_FAILED",
        category: "internal",
        sideEffectStatus: stage === "execution_completed"
          ? "completed_unknown"
          : "none",
        ...errorIdentity(active.invocation, tool),
      });
    }
  }

  #timestamp(): string {
    const value = this.#clock.now();
    if (
      typeof value !== "string" ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value
    ) {
      throw new TypeError("Tool execution clock returned an invalid timestamp");
    }
    return value;
  }
}

export class ToolDispatcher {
  constructor(readonly pipeline: ToolExecutionPipeline) {}

  execute(
    invocation: ToolInvocation,
    options: ToolDispatchOptions,
  ): Promise<ToolResult> {
    return this.pipeline.execute(invocation, options);
  }

  cancel(toolCallId: string): Promise<ToolCancelResult> {
    return this.pipeline.cancel(toolCallId);
  }
}

function resolveTool(
  registryView: ToolRegistryView,
  invocation: CapturedToolInvocation,
): RegisteredTool {
  const tool = registryView.get(invocation.toolName);
  if (!tool) {
    throw new ToolError({
      code: "TOOL_NOT_AVAILABLE",
      category: "validation",
      sideEffectStatus: "none",
      ...errorIdentity(invocation),
    });
  }
  if (
    invocation.toolVersion !== undefined &&
    invocation.toolVersion !== tool.descriptor.version
  ) {
    throw new ToolError({
      code: "TOOL_VERSION_MISMATCH",
      category: "validation",
      sideEffectStatus: "none",
      ...errorIdentity(invocation, tool),
    });
  }
  return tool;
}

function captureArguments(
  tool: RegisteredTool,
  invocation: CapturedToolInvocation,
): JsonValue {
  try {
    return captureToolArguments(tool.descriptor, invocation.arguments) as JsonValue;
  } catch {
    throw new ToolError({
      code: "TOOL_ARGUMENTS_INVALID",
      category: "validation",
      sideEffectStatus: "none",
      ...errorIdentity(invocation, tool),
    });
  }
}

function assertSandboxCapability(
  sandbox: SandboxExecutor,
  policy: ToolExecutionPolicy,
  invocation: CapturedToolInvocation,
  tool: RegisteredTool,
): void {
  if (
    policy.isolation === "os_process" &&
    sandbox.capabilities.isolation !== "os_process"
  ) {
    throw new ToolError({
      code: "TOOL_ISOLATION_UNAVAILABLE",
      category: "sandbox",
      sideEffectStatus: "none",
      ...errorIdentity(invocation, tool),
    });
  }
}

function createValidatedProgressSink(
  target: ToolProgressSink,
  invocation: CapturedToolInvocation,
  tool: RegisteredTool,
): ToolProgressSink {
  return Object.freeze({
    async emit(update: ToolExecutionUpdate): Promise<void> {
      try {
        await target.emit(captureToolExecutionUpdate(update));
      } catch (error) {
        if (error instanceof ToolProtocolError) {
          throw new ToolError({
            code: "TOOL_PROGRESS_INVALID",
            category: "execution",
            sideEffectStatus: "possible",
            ...errorIdentity(invocation, tool),
          });
        }
        throw new ToolError({
          code: "TOOL_PROGRESS_SINK_FAILED",
          category: "internal",
          sideEffectStatus: "possible",
          ...errorIdentity(invocation, tool),
        });
      }
    },
  });
}

function captureSignal(
  signal: AbortSignal,
  invocation: ToolInvocation,
): AbortSignal {
  if (
    !signal ||
    typeof signal !== "object" ||
    typeof signal.aborted !== "boolean" ||
    typeof signal.addEventListener !== "function"
  ) {
    throw validationError(invocation);
  }
  return signal;
}

function normalizeToolFailure(
  error: unknown,
  invocation: CapturedToolInvocation,
  tool?: RegisteredTool,
): ToolError {
  if (error instanceof ToolError) {
    return new ToolError({
      code: error.code,
      category: error.category,
      retryable: error.retryable,
      sideEffectStatus: error.sideEffectStatus,
      ...errorIdentity(invocation, tool),
    });
  }
  if (error instanceof ToolProtocolError) {
    return new ToolError({
      code: "TOOL_RESULT_INVALID",
      category: "execution",
      sideEffectStatus: "completed_unknown",
      ...errorIdentity(invocation, tool),
    });
  }
  return new ToolError({
    code: "TOOL_HANDLER_FAILED",
    category: "execution",
    sideEffectStatus: "completed_unknown",
    ...errorIdentity(invocation, tool),
  });
}

function validationError(invocation: Partial<ToolInvocation>): ToolError {
  return new ToolError({
    code: "TOOL_INVOCATION_INVALID",
    category: "validation",
    sideEffectStatus: "none",
    conversationId: safeIdentity(invocation?.conversationId),
    runId: safeIdentity(invocation?.runId),
    toolCallId: safeIdentity(invocation?.toolCallId),
    toolName: safeToolName(invocation?.toolName),
  });
}

function cancelledError(
  invocation: CapturedToolInvocation,
  sideEffectStatus: ToolSideEffectStatus,
  tool?: RegisteredTool,
): ToolError {
  return new ToolError({
    code: "TOOL_EXECUTION_CANCELLED",
    category: "cancelled",
    sideEffectStatus,
    ...errorIdentity(invocation, tool),
  });
}

function timeoutError(
  invocation: CapturedToolInvocation,
  sideEffectStatus: ToolSideEffectStatus,
  tool?: RegisteredTool,
): ToolError {
  return new ToolError({
    code: "TOOL_EXECUTION_TIMED_OUT",
    category: "timeout",
    sideEffectStatus,
    ...errorIdentity(invocation, tool),
  });
}

function shouldRetry(
  policy: ToolExecutionPolicy,
  error: ToolError,
  attempt: number,
): boolean {
  return (
    attempt < policy.retry.maximumAttempts &&
    policy.idempotent &&
    error.retryable &&
    error.category !== "cancelled" &&
    error.sideEffectStatus === "none"
  );
}

function internalError(
  code: string,
  invocation: CapturedToolInvocation,
  tool?: RegisteredTool,
): ToolError {
  return new ToolError({
    code,
    category: "internal",
    sideEffectStatus: "none",
    ...errorIdentity(invocation, tool),
  });
}

function approvalIdentity(
  invocation: CapturedToolInvocation,
  tool: RegisteredTool,
): ToolApprovalIdentity {
  return captureToolApprovalIdentity({
    conversationId: invocation.conversationId,
    runId: invocation.runId,
    toolCallId: invocation.toolCallId,
    toolName: tool.descriptor.name,
    toolVersion: tool.descriptor.version,
    argumentDigest: invocation.argumentDigest,
  });
}

function sameApprovalIdentity(
  left: ToolApprovalIdentity,
  right: ToolApprovalIdentity,
): boolean {
  return (
    left.conversationId === right.conversationId &&
    left.runId === right.runId &&
    left.toolCallId === right.toolCallId &&
    left.toolName === right.toolName &&
    left.toolVersion === right.toolVersion &&
    left.argumentDigest === right.argumentDigest
  );
}

function errorIdentity(
  invocation: CapturedToolInvocation,
  tool?: RegisteredTool,
) {
  return {
    conversationId: invocation.conversationId,
    runId: invocation.runId,
    toolCallId: invocation.toolCallId,
    toolName: tool?.descriptor.name ?? invocation.toolName,
    ...(tool === undefined ? {} : { toolVersion: tool.descriptor.version }),
  };
}

function logIdentity(
  invocation: CapturedToolInvocation,
  tool?: RegisteredTool,
) {
  return {
    conversationId: invocation.conversationId,
    runId: invocation.runId,
    toolCallId: invocation.toolCallId,
    toolName: tool?.descriptor.name ?? invocation.toolName,
    ...(tool === undefined ? {} : { toolVersion: tool.descriptor.version }),
  };
}

function safeIdentity(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
    ? value
    : undefined;
}

function safeToolName(value: unknown): string | undefined {
  return isToolName(value) ? value : undefined;
}

function captureResultLimits(value: ToolResultLimits): ToolResultLimits {
  if (!value || typeof value !== "object") {
    throw new TypeError("Tool result limits are invalid");
  }
  for (const limit of [
    value.maximumContentBlocks,
    value.maximumTextBytes,
    value.maximumDetailsBytes,
    value.maximumArtifactReferences,
  ]) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new TypeError("Tool result limits are invalid");
    }
  }
  return Object.freeze({ ...value });
}

function byteLength(value: JsonValue): number {
  return new TextEncoder().encode(canonicalStringifyJson(value)).byteLength;
}

function elapsedMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

const SYSTEM_TOOL_EXECUTION_CLOCK: ToolExecutionClock = Object.freeze({
  now: () => new Date().toISOString(),
});

const SYSTEM_TOOL_EXECUTION_TIMER: ToolExecutionTimer = Object.freeze({
  schedule(delayMs: number, callback: () => void): () => void {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
});

const DEFAULT_TOOL_TRACE_ID_FACTORY: ToolTraceIdFactory = Object.freeze({
  create(invocation: CapturedToolInvocation): string {
    return `trace_${invocation.runId}_${invocation.toolCallId}`;
  },
});
