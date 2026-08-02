/** Validated Tool execution pipeline and its public Dispatcher facade. */
import type { JsonValue } from "../../event/protocol/index.js";
import type { Logger } from "../../observability/index.js";
import { noopLogger } from "../../observability/index.js";
import type { InteractionCoordinator } from "../../runtime/interaction/ToolApprovalInteractionProtocol.js";
import type { ToolApprovalRequest } from "../../runtime/interaction/ToolApprovalInteractionProtocol.js";
import type { RegisteredTool } from "../protocol/RegisteredTool.js";
import type {
  ToolExecutionUpdate,
  ToolProgressSink,
} from "../protocol/ToolProgress.js";
import { noopToolProgressSink } from "../protocol/ToolProgress.js";
import type { ToolResult, ToolResultLimits } from "../protocol/ToolResult.js";
import {
  captureToolArguments,
  captureToolExecutionUpdate,
  captureToolResult,
} from "../protocol/ToolProtocolValidator.js";
import { ToolProtocolError } from "../protocol/ToolProtocolErrors.js";
import type { ToolRegistryView } from "../registry/ToolRegistryView.js";
import type {
  CapturedToolInvocation,
  ToolApprovalIdentity,
  ToolArgumentDigester,
  ToolExecutionPolicy,
  ToolInvocation,
  ToolPermissionDecision,
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

export interface ToolExecutionPipelineOptions {
  readonly registryView: ToolRegistryView;
  readonly argumentDigester: ToolArgumentDigester;
  readonly executionPolicyResolver: ToolExecutionPolicyResolver;
  readonly permissionPolicy: ToolPermissionPolicy;
  readonly interactionCoordinator: InteractionCoordinator;
  readonly approvalRequestFactory: ToolApprovalRequestFactory;
  readonly sandboxExecutor: SandboxExecutor;
  readonly resultLimits: ToolResultLimits;
  readonly logger?: Logger;
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
  readonly #logger: Logger;

  constructor(options: ToolExecutionPipelineOptions) {
    this.#registryView = options.registryView;
    this.#argumentDigester = options.argumentDigester;
    this.#executionPolicyResolver = options.executionPolicyResolver;
    this.#permissionPolicy = options.permissionPolicy;
    this.#interactionCoordinator = options.interactionCoordinator;
    this.#approvalRequestFactory = options.approvalRequestFactory;
    this.#sandboxExecutor = options.sandboxExecutor;
    this.#resultLimits = captureResultLimits(options.resultLimits);
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
    const signal = captureSignal(options?.signal, invocation);
    this.#logger.info("runtime.tool.execution_started", logIdentity(invocation));

    try {
      if (signal.aborted) throw cancelledError(invocation, "none");
      const tool = resolveTool(this.#registryView, invocation);
      const executionPolicy = this.#executionPolicyResolver.resolve(tool);
      const arguments_ = captureArguments(tool, invocation);
      const permission = this.#evaluatePermission(
        invocation,
        tool,
        executionPolicy,
      );
      await this.#authorize(invocation, tool, executionPolicy, permission);
      assertSandboxCapability(this.#sandboxExecutor, executionPolicy, invocation, tool);
      if (signal.aborted) throw cancelledError(invocation, "none", tool);

      const progress = createValidatedProgressSink(
        options.progress ?? noopToolProgressSink,
        invocation,
        tool,
      );
      const rawResult = await this.#executeSandbox(
        tool,
        invocation,
        executionPolicy,
        arguments_,
        signal,
        progress,
      );
      const result = captureToolResult(rawResult, {
        conversationId: invocation.conversationId,
        toolCallId: invocation.toolCallId,
        toolName: tool.descriptor.name,
        toolVersion: tool.descriptor.version,
        limits: this.#resultLimits,
      });
      this.#logger.info("runtime.tool.execution_completed", {
        ...logIdentity(invocation, tool),
        resultBlockCount: result.content.length,
        artifactCount: result.artifacts?.length ?? 0,
      });
      return result;
    } catch (error) {
      const normalized = normalizeToolFailure(error, invocation);
      this.#logger.info("runtime.tool.execution_failed", {
        ...logIdentity(invocation),
        errorCode: normalized.code,
        errorCategory: normalized.category,
        retryable: normalized.retryable,
        sideEffectStatus: normalized.sideEffectStatus,
      });
      throw normalized;
    }
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
    invocation: CapturedToolInvocation,
    tool: RegisteredTool,
    executionPolicy: ToolExecutionPolicy,
    permission: ToolPermissionDecision,
  ): Promise<void> {
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

    const resolution = await this.#interactionCoordinator.request(request);
    if (!sameApprovalIdentity(resolution.identity, identity)) {
      throw internalError("TOOL_APPROVAL_IDENTITY_MISMATCH", invocation, tool);
    }
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
    tool: RegisteredTool,
    invocation: CapturedToolInvocation,
    policy: ToolExecutionPolicy,
    arguments_: JsonValue,
    signal: AbortSignal,
    progress: ToolProgressSink,
  ): Promise<ToolResult> {
    try {
      return await this.#sandboxExecutor.execute({
        tool,
        context: Object.freeze({
          conversationId: invocation.conversationId,
          runId: invocation.runId,
          toolCallId: invocation.toolCallId,
          ...(invocation.turnId === undefined ? {} : { turnId: invocation.turnId }),
          signal,
        }),
        arguments: arguments_,
        progress,
        policy,
      });
    } catch (error) {
      if (signal.aborted) throw cancelledError(invocation, "completed_unknown", tool);
      throw normalizeToolFailure(error, invocation, tool);
    }
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
  if (error instanceof ToolError) return error;
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
  sideEffectStatus: "none" | "completed_unknown",
  tool?: RegisteredTool,
): ToolError {
  return new ToolError({
    code: "TOOL_EXECUTION_CANCELLED",
    category: "cancelled",
    sideEffectStatus,
    ...errorIdentity(invocation, tool),
  });
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
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value)
    ? value
    : undefined;
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
