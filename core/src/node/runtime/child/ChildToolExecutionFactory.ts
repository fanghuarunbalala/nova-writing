/**
 * Composes the desktop child Runtime's Tool pipeline, permission rules, and
 * Approval coordinator from the restored Manifest Tool View.
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  InMemoryInteractionCoordinator,
  type InteractionCoordinator,
  type ToolApprovalRequest,
  type ToolApprovalRequestFactory,
  type ToolExecutionPolicy,
  type ToolPermissionRule,
} from "../../../runtime/index.js";
import {
  RuntimeEventToolTraceSink,
  type RuntimeEventSink,
} from "../../../runtime/execution/event/index.js";
import {
  INITIAL_TOOL_PERMISSION_RULES,
  LayeredToolPermissionPolicy,
  StaticToolExecutionPolicyResolver,
  ToolDispatcher,
  ToolExecutionPipeline,
  TrustedProcessSandboxExecutor,
} from "../../../runtime/tools/execution/index.js";
import type {
  ToolRegistryView,
  ToolResultLimits,
} from "../../../tooling/index.js";
import { NodeSha256ToolArgumentDigester } from "../../tools/index.js";

export interface ChildToolExecutionCompositionOptions {
  readonly registryView: ToolRegistryView;
  readonly eventSink: RuntimeEventSink;
  readonly logger?: Logger;
}

export interface ChildToolExecutionComposition {
  readonly dispatcher: ToolDispatcher;
  readonly coordinator: InteractionCoordinator;
}

const DEFAULT_TOOL_RESULT_LIMITS: ToolResultLimits = Object.freeze({
  maximumContentBlocks: 32,
  maximumTextBytes: 256 * 1024,
  maximumDetailsBytes: 256 * 1024,
  maximumArtifactReferences: 16,
});

const DEFAULT_TOOL_EXECUTION_POLICY: ToolExecutionPolicy = Object.freeze({
  timeoutMs: 300_000,
  isolation: "trusted_process",
  cancellable: true,
  idempotent: false,
  restartable: false,
  checkpointable: false,
  retry: Object.freeze({ maximumAttempts: 1 }),
});

export const CHILD_TOOL_PERMISSION_RULES: readonly ToolPermissionRule[] =
  Object.freeze([
    Object.freeze({
      ruleId: "child_read_allow",
      source: "built_in",
      effect: "allow",
      match: Object.freeze({
        toolNames: Object.freeze([
          "NovelOutlineRead",
          "NovelCharacterRead",
          "NovelLocationRead",
          "TodoWrite",
        ]),
      }),
    }),
    Object.freeze({
      ruleId: "child_write_edit_ask",
      source: "built_in",
      effect: "ask",
      match: Object.freeze({
        toolNames: Object.freeze([
          "NovelOutlineWrite",
          "NovelOutlineEdit",
          "NovelCharacterWrite",
          "NovelCharacterEdit",
          "NovelLocationWrite",
          "NovelLocationEdit",
        ]),
      }),
    }),
  ]);

export function createChildToolExecutionComposition(
  options: ChildToolExecutionCompositionOptions,
): ChildToolExecutionComposition {
  const logger = (options.logger ?? noopLogger).child({
    component: "child_tool_execution",
  });
  const coordinator = new InMemoryInteractionCoordinator({
    eventSink: options.eventSink,
    logger,
  });
  const policyResolver = new StaticToolExecutionPolicyResolver([
    { toolName: "TodoWrite", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelOutlineRead", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelOutlineWrite", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelOutlineEdit", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelCharacterRead", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelCharacterWrite", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelCharacterEdit", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelLocationRead", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelLocationWrite", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelLocationEdit", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
  ]);
  const permissionPolicy = new LayeredToolPermissionPolicy([
    ...INITIAL_TOOL_PERMISSION_RULES,
    ...CHILD_TOOL_PERMISSION_RULES,
  ]);
  const dispatcher = new ToolDispatcher(
    new ToolExecutionPipeline({
      registryView: options.registryView,
      argumentDigester: new NodeSha256ToolArgumentDigester(),
      executionPolicyResolver: policyResolver,
      permissionPolicy,
      interactionCoordinator: coordinator,
      approvalRequestFactory: createChildToolApprovalRequestFactory(),
      sandboxExecutor: new TrustedProcessSandboxExecutor(),
      resultLimits: DEFAULT_TOOL_RESULT_LIMITS,
      traceSink: new RuntimeEventToolTraceSink({
        eventSink: options.eventSink,
      }),
      logger,
    }),
  );
  return Object.freeze({ dispatcher, coordinator });
}

function createChildToolApprovalRequestFactory(): ToolApprovalRequestFactory {
  return {
    create(input): ToolApprovalRequest {
      const approvalRequestId =
        `tool-approval:${input.identity.conversationId}:${input.identity.runId}:${input.identity.toolCallId}`;
      const requestedAt = new Date().toISOString();
      return Object.freeze({
        approvalRequestId,
        identity: input.identity,
        ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
        summary: Object.freeze({
          title: input.toolLabel,
          ...(input.toolDescription === undefined
            ? {}
            : { description: input.toolDescription }),
        }),
        requestedAt,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      });
    },
  };
}
