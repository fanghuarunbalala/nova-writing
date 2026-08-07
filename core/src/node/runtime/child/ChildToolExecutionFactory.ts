/**
 * Composes the desktop child Runtime's Tool pipeline, permission rules, and
 * Approval coordinator from the restored Manifest Tool View.
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { ToolApprovalOperationSummary } from "../../../event/output/payload/ToolApprovalLifecyclePayloads.js";
import type { JsonValue } from "../../../event/protocol/index.js";
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
  ComposeAwareToolPermissionPolicy,
  INITIAL_TOOL_PERMISSION_RULES,
  LayeredToolPermissionPolicy,
  StaticToolExecutionPolicyResolver,
  ToolDispatcher,
  ToolExecutionPipeline,
  TrustedProcessSandboxExecutor,
} from "../../../runtime/tools/execution/index.js";
import {
  ComposeApprovalLifecycleSink,
  ComposeModeStateProvider,
} from "../../../runtime/compose/index.js";
import type {
  ToolRegistryView,
  ToolResultLimits,
} from "../../../tooling/index.js";
import { NodeSha256ToolArgumentDigester } from "../../tools/index.js";

export interface ChildToolExecutionCompositionOptions {
  readonly registryView: ToolRegistryView;
  readonly eventSink: RuntimeEventSink;
  /** compose 状态源；缺省新建空 provider。Compose state source; defaults to a fresh provider. */
  readonly composeStateProvider?: ComposeModeStateProvider;
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
          "NovelParagraphRead",
          "NovelVolumeRead",
          "NovelChapterRead",
          "NovelDraftStatus",
          "TodoWrite",
        ]),
      }),
    }),
    Object.freeze({
      ruleId: "child_files_read_allow",
      source: "built_in",
      effect: "allow",
      match: Object.freeze({
        toolNames: Object.freeze(["Read", "Glob"]),
      }),
    }),
    Object.freeze({
      ruleId: "child_compose_enter_allow",
      source: "built_in",
      effect: "allow",
      match: Object.freeze({
        toolNames: Object.freeze(["EnterComposeMode"]),
      }),
    }),
    Object.freeze({
      ruleId: "child_compose_exit_ask",
      source: "built_in",
      effect: "ask",
      match: Object.freeze({
        toolNames: Object.freeze(["ExitComposeMode"]),
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
          "NovelParagraphWrite",
          "NovelParagraphEdit",
          "NovelVolumeWrite",
          "NovelVolumeEdit",
          "NovelChapterWrite",
          "NovelChapterEdit",
          "NovelDelete",
          "NovelDraftCommit",
          "NovelDraftRollback",
          "NovelDraftRebase",
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
  const eventSink =
    options.composeStateProvider === undefined
      ? options.eventSink
      : new ComposeApprovalLifecycleSink(
          options.eventSink,
          options.composeStateProvider,
        );
  const coordinator = new InMemoryInteractionCoordinator({
    eventSink,
    logger,
  });
  const policyResolver = new StaticToolExecutionPolicyResolver([
    { toolName: "TodoWrite", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "Read", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "Glob", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "Write", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "Edit", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "EnterComposeMode", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "ExitComposeMode", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelOutlineRead", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelOutlineWrite", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelOutlineEdit", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelCharacterRead", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelCharacterWrite", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelCharacterEdit", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelLocationRead", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelLocationWrite", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelLocationEdit", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelParagraphRead", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelParagraphWrite", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelParagraphEdit", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelVolumeRead", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelVolumeWrite", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelVolumeEdit", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelChapterRead", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelChapterWrite", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelChapterEdit", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelDelete", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelDraftStatus", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelDraftCommit", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelDraftRollback", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
    { toolName: "NovelDraftRebase", toolVersion: "1.0.0", policy: DEFAULT_TOOL_EXECUTION_POLICY },
  ]);
  const permissionPolicy = new ComposeAwareToolPermissionPolicy(
    new LayeredToolPermissionPolicy([
      ...INITIAL_TOOL_PERMISSION_RULES,
      ...CHILD_TOOL_PERMISSION_RULES,
    ]),
    options.composeStateProvider ?? new ComposeModeStateProvider(),
  );
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
        eventSink,
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
      const operations = buildApprovalOperations(input);
      const summary = buildApprovalSummary(input, operations);
      return Object.freeze({
        approvalRequestId,
        identity: input.identity,
        ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
        summary,
        requestedAt,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      });
    },
  };
}

const MAX_APPROVAL_ARGUMENTS_BYTES = 256 * 1024;

const APPROVAL_OP_LABEL = {
  add: "新增",
  edit: "修改",
  delete: "删除",
} as const;

const APPROVAL_KIND_LABEL: Record<string, string> = Object.freeze({
  outline: "大纲单元",
  character: "角色",
  location: "地点",
  paragraph: "段落",
  volume: "卷",
  chapter: "章节",
});

const WRITE_KIND_BY_TOOL_NAME: Record<string, string> = Object.freeze({
  NovelOutlineWrite: "outline",
  NovelOutlineEdit: "outline",
  NovelCharacterWrite: "character",
  NovelCharacterEdit: "character",
  NovelLocationWrite: "location",
  NovelLocationEdit: "location",
  NovelParagraphWrite: "paragraph",
  NovelParagraphEdit: "paragraph",
  NovelVolumeWrite: "volume",
  NovelVolumeEdit: "volume",
  NovelChapterWrite: "chapter",
  NovelChapterEdit: "chapter",
});

const NOVEL_DELETE_KIND_MAP: Record<string, string> = Object.freeze({
  story_unit: "outline",
  character: "character",
  location: "location",
  paragraph: "paragraph",
  volume: "volume",
  chapter: "chapter",
});

/** 从工具名推导操作类型（Write/Edit/Delete 后缀）。Derive op from tool name. */
function approvalOpOf(toolName: string): ToolApprovalOperationSummary["op"] | undefined {
  if (toolName.endsWith("Write")) return "add";
  if (toolName.endsWith("Edit")) return "edit";
  if (toolName === "NovelDelete") return "delete";
  return undefined;
}

/** 从工具参数提取每目标一行的操作摘要。Build per-target operation rows. */
function buildApprovalOperations(
  input: Parameters<ToolApprovalRequestFactory["create"]>[0],
): readonly ToolApprovalOperationSummary[] {
  const toolName = input.identity.toolName;
  const op = approvalOpOf(toolName);
  if (op === undefined || !isRecord(input.arguments)) return Object.freeze([]);
  const values = input.arguments.values;
  if (!Array.isArray(values) || values.length === 0) return Object.freeze([]);

  if (op === "delete") {
    return Object.freeze(
      values
        .map((value, index): ToolApprovalOperationSummary | undefined => {
          if (!isRecord(value) || typeof value.id !== "string") return undefined;
          const kind = NOVEL_DELETE_KIND_MAP[
            typeof value.kind === "string" ? value.kind : ""
          ];
          if (kind === undefined) return undefined;
          return Object.freeze({ op, kind, id: value.id, title: value.id });
        })
        .filter((item): item is ToolApprovalOperationSummary => item !== undefined),
    );
  }

  const kind = WRITE_KIND_BY_TOOL_NAME[toolName];
  if (kind === undefined) return Object.freeze([]);
  return Object.freeze(
    values
      .map((value, index): ToolApprovalOperationSummary | undefined => {
        if (!isRecord(value)) return undefined;
        const patch = isRecord(value.value) ? value.value : undefined;
        const id = asString(value.id) ?? asString(patch?.id);
        const title =
          asString(value.title) ??
          asString(value.name) ??
          asString(patch?.title) ??
          asString(patch?.name) ??
          id ??
          `#${index + 1}`;
        return Object.freeze({
          op,
          kind,
          ...(id === undefined ? {} : { id }),
          ...(title === undefined ? {} : { title: boundedApprovalText(title, 500) }),
        });
      })
      .filter((item): item is ToolApprovalOperationSummary => item !== undefined),
  );
}

/** 组装审批摘要：标题/描述/操作行/完整参数（超限降级省略）。Build approval summary. */
function buildApprovalSummary(
  input: Parameters<ToolApprovalRequestFactory["create"]>[0],
  operations: readonly ToolApprovalOperationSummary[],
): ToolApprovalRequest["summary"] {
  if (input.identity.toolName === "ExitComposeMode") {
    return Object.freeze({
      title: "提交设计草稿",
      description: "请确认设计草稿内容后批准；批准后按草稿内容落库。",
    });
  }
  const first = operations[0];
  const title =
    first === undefined
      ? input.toolLabel
      : `${APPROVAL_OP_LABEL[first.op]}${APPROVAL_KIND_LABEL[first.kind] ?? first.kind}`;
  const descriptions: string[] = [];
  if (operations.length > 0) {
    const targets = operations
      .map((operation) => operation.title ?? operation.id)
      .filter((item): item is string => item !== undefined);
    descriptions.push(
      compactTargets(targets, operations.length),
    );
  }
  const arguments_ = boundedApprovalArguments(input.arguments);
  if (arguments_ === undefined) {
    descriptions.push("参数超过展示上限，未随审批携带完整内容");
  }
  return Object.freeze({
    title,
    ...(descriptions.length > 0
      ? { description: descriptions.join("；") }
      : {}),
    ...(arguments_ === undefined ? {} : { arguments: arguments_ }),
    ...(operations.length > 0 ? { operations } : {}),
  });
}

function compactTargets(targets: readonly string[], total: number): string {
  const prefix = `目标：${targets.join("、")}`;
  const bytes = new TextEncoder().encode(prefix).byteLength;
  if (bytes <= 1024) return prefix;
  const kept: string[] = [];
  let used = 0;
  for (const target of targets) {
    const next = used === 0 ? target : `${target}、`;
    const nextBytes = new TextEncoder().encode(next).byteLength;
    if (used + nextBytes > 900) break;
    kept.push(target);
    used += new TextEncoder().encode(`${target}、`).byteLength;
  }
  return `目标：${kept.join("、")} 等 ${total} 项`;
}

function boundedApprovalArguments(value: JsonValue): JsonValue | undefined {
  try {
    const serialized = JSON.stringify(value);
    if (
      serialized === undefined ||
      new TextEncoder().encode(serialized).byteLength > MAX_APPROVAL_ARGUMENTS_BYTES
    ) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

function boundedApprovalText(value: string, maximumBytes: number): string {
  if (new TextEncoder().encode(value).byteLength <= maximumBytes) return value;
  const characters = [...value];
  let kept = "";
  let used = 0;
  for (const character of characters) {
    const bytes = new TextEncoder().encode(character).byteLength;
    if (used + bytes > maximumBytes) break;
    kept += character;
    used += bytes;
  }
  return kept;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
