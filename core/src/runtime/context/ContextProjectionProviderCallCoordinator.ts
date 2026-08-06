/** Applies one provider-neutral Context Projection without mutating canonical history. */
import {
  canonicalStringifyJson,
  type JsonValue,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  coreRuntimeMessageSchemaRegistry,
  type RuntimeMessageSchemaRegistry,
  type RuntimeMessageSnapshot,
} from "../message/index.js";
import {
  CORE_RUNTIME_MESSAGE_TYPE,
  RUNTIME_MESSAGE_SCHEMA_VERSION,
  type RuntimeMessageDraft,
} from "../message/index.js";
import { ContextCheckpointOverlayRenderer } from "./ContextCheckpointOverlayRenderer.js";
import { ContextProjectionPlanner } from "./ContextProjectionPlanner.js";
import {
  CONTEXT_PROJECTION_PLANNER_FAILURE,
  ContextProjectionPlannerError,
  type ContextProjectionPlannerFailure,
} from "./ContextProjectionPlannerErrors.js";
import type {
  ContextCheckpointOverlay,
  ContextProjectionCandidate,
  ContextProjectionCandidateProvider,
  ContextProjectionProviderCallRequest,
  ContextProjectionProviderCallResult,
} from "./ContextProjectionPlannerProtocol.js";

export interface ContextProjectionProviderCallCoordinatorOptions {
  readonly candidateProvider: ContextProjectionCandidateProvider;
  readonly planner?: ContextProjectionPlanner;
  readonly overlayRenderer?: ContextCheckpointOverlayRenderer;
  readonly messageSchemaRegistry?: RuntimeMessageSchemaRegistry;
  readonly logger?: Logger;
}

export class ContextProjectionProviderCallCoordinator {
  private readonly candidateProvider: ContextProjectionCandidateProvider;
  private readonly planner: ContextProjectionPlanner;
  private readonly overlayRenderer: ContextCheckpointOverlayRenderer;
  private readonly messageSchemaRegistry: RuntimeMessageSchemaRegistry;
  private readonly logger: Logger;

  constructor(options: ContextProjectionProviderCallCoordinatorOptions) {
    this.candidateProvider = options.candidateProvider;
    this.planner =
      options.planner ?? new ContextProjectionPlanner({ logger: options.logger });
    this.overlayRenderer =
      options.overlayRenderer ?? new ContextCheckpointOverlayRenderer();
    this.messageSchemaRegistry =
      options.messageSchemaRegistry ?? coreRuntimeMessageSchemaRegistry;
    this.logger = (options.logger ?? noopLogger).child({
      component: "context_projection_provider_call_coordinator",
    });
  }

  async prepare(
    request: ContextProjectionProviderCallRequest,
  ): Promise<ContextProjectionProviderCallResult> {
    let identity: ProjectionProviderCallIdentity;
    try {
      identity = captureIdentity(request);
    } catch {
      throw this.failure(
        CONTEXT_PROJECTION_PLANNER_FAILURE.applicationFailed,
        capturePartialIdentity(request),
      );
    }
    let canonicalMessages: readonly RuntimeMessageSnapshot[];
    try {
      canonicalMessages = this.captureMessages(request, identity);
    } catch {
      throw this.failure(
        CONTEXT_PROJECTION_PLANNER_FAILURE.applicationFailed,
        identity,
      );
    }

    this.logger.debug("runtime.context.projection_application_started", {
      ...identity,
      canonicalMessageCount: canonicalMessages.length,
      transientMessageCount: request.transientMessageCount,
    });

    let candidate: ContextProjectionCandidate;
    try {
      candidate = await this.candidateProvider.load({
        ...identity,
        canonicalMessages,
        transientMessageCount: request.transientMessageCount,
      });
    } catch {
      throw this.failure(
        CONTEXT_PROJECTION_PLANNER_FAILURE.candidateLoadFailed,
        identity,
      );
    }

    try {
      assertCandidateIdentity(candidate, request, identity);
      assertCanonicalClassification(candidate, canonicalMessages);
    } catch (error) {
      if (error instanceof ContextProjectionPlannerError) throw error;
      throw this.failure(
        CONTEXT_PROJECTION_PLANNER_FAILURE.invalidCandidate,
        identity,
        candidate?.checkpoint?.id,
      );
    }

    const plan = this.planner.plan(candidate);
    let checkpointOverlay: ContextCheckpointOverlay | undefined;
    try {
      checkpointOverlay = candidate.checkpoint
        ? this.overlayRenderer.render(candidate.checkpoint, plan.projection)
        : undefined;
    } catch {
      throw this.failure(
        CONTEXT_PROJECTION_PLANNER_FAILURE.overlayRenderFailed,
        identity,
        candidate.checkpoint?.id,
      );
    }

    // system.reminder 消息永不删除：无论窗口/固定策略如何，全部强制保留，
    // 保持消息前缀稳定，不破坏 provider prefill 缓存。
    // system.reminder messages are never deleted: always force-selected so the
    // message prefix stays stable and provider prefill caches remain valid.
    const selectedMessageIds = new Set([
      ...plan.selectedPinnedMessageIds,
      ...plan.selectedRecentMessageIds,
      ...canonicalMessages
        .filter(
          (message) =>
            message.messageType === CORE_RUNTIME_MESSAGE_TYPE.systemReminder,
        )
        .map((message) => message.id),
    ]);
    const projectedMessages = Object.freeze(
      canonicalMessages.filter((message) => selectedMessageIds.has(message.id)),
    );
    // checkpoint 摘要以 compact_summary system.reminder 消息进入消息层，
    // 不再拼进 system prompt（systemPrompt 恒为 base，保持 prefill 缓存稳定）。
    // Checkpoint summaries are delivered as compact_summary system.reminder
    // messages; the system prompt always stays the base.
    const compactSummaryMessage = checkpointOverlay
      ? createCompactSummaryMessage(
          identity,
          checkpointOverlay,
          canonicalMessages,
        )
      : undefined;
    const systemPrompt = request.baseSystemPrompt;
    const result = Object.freeze({
      context: Object.freeze({
        conversationId: identity.conversationId,
        runId: identity.runId,
        systemPrompt,
        messages: compactSummaryMessage === undefined
          ? projectedMessages
          : Object.freeze([...projectedMessages, compactSummaryMessage]),
      }),
      projection: plan.projection,
      ...(checkpointOverlay === undefined ? {} : { checkpointOverlay }),
    });
    this.logger.info("runtime.context.projection_application_completed", {
      ...identity,
      checkpointId: plan.projection.checkpointId ?? "none",
      reminderMessageCount: canonicalMessages.filter(
        (message) =>
          message.messageType === CORE_RUNTIME_MESSAGE_TYPE.systemReminder,
      ).length,
        projectedMessageCount: projectedMessages.length,
        compactSummaryCount: compactSummaryMessage === undefined ? 0 : 1,
      selectedCheckpointItemCount:
        plan.projection.selectedCheckpointItemIds.length,
      degradationLevel: plan.projection.degradationLevel,
      tokenEstimate: plan.projection.tokenEstimate,
    });
    return result;
  }

  private captureMessages(
    request: ContextProjectionProviderCallRequest,
    identity: ProjectionProviderCallIdentity,
  ): readonly RuntimeMessageSnapshot[] {
    if (
      typeof request.baseSystemPrompt !== "string" ||
      !Array.isArray(request.canonicalMessages) ||
      !Number.isSafeInteger(request.transientMessageCount) ||
      request.transientMessageCount < 0
    ) {
      throw new TypeError("Context Projection application request is invalid");
    }
    const seen = new Set<string>();
    return Object.freeze(
      request.canonicalMessages.map((message) => {
        const captured = this.messageSchemaRegistry.validateSnapshot(message);
        if (
          captured.conversationId !== identity.conversationId ||
          seen.has(captured.id)
        ) {
          throw new TypeError("Context Projection Message identity is invalid");
        }
        seen.add(captured.id);
        return deepFreeze(
          JSON.parse(
            canonicalStringifyJson(captured as unknown as JsonValue),
          ) as RuntimeMessageSnapshot,
        );
      }),
    );
  }

  private failure(
    failure: ContextProjectionPlannerFailure,
    identity: Partial<ProjectionProviderCallIdentity>,
    checkpointId?: string,
  ): ContextProjectionPlannerError {
    this.logger.error("runtime.context.projection_application_failed", {
      failure,
      ...(identity.conversationId
        ? { conversationId: identity.conversationId }
        : {}),
      ...(identity.runId ? { runId: identity.runId } : {}),
      ...(identity.providerCallId
        ? { providerCallId: identity.providerCallId }
        : {}),
      ...(checkpointId ? { checkpointId } : {}),
    });
    return new ContextProjectionPlannerError(
      failure,
      identity.conversationId,
      identity.runId,
      identity.providerCallId,
      checkpointId,
    );
  }
}

interface ProjectionProviderCallIdentity {
  readonly conversationId: string;
  readonly runId: string;
  readonly providerCallId: string;
}

function captureIdentity(
  request: ContextProjectionProviderCallRequest,
): ProjectionProviderCallIdentity {
  const conversationId = captureNonBlank(request?.conversationId);
  const runId = captureNonBlank(request?.runId);
  const providerCallId = captureNonBlank(request?.providerCallId);
  if (!conversationId || !runId || !providerCallId) {
    throw new TypeError("Context Projection application identity is invalid");
  }
  return Object.freeze({ conversationId, runId, providerCallId });
}

function capturePartialIdentity(
  request: Partial<ContextProjectionProviderCallRequest> | undefined,
): Partial<ProjectionProviderCallIdentity> {
  const conversationId = captureNonBlank(request?.conversationId);
  const runId = captureNonBlank(request?.runId);
  const providerCallId = captureNonBlank(request?.providerCallId);
  return Object.freeze({
    ...(conversationId ? { conversationId } : {}),
    ...(runId ? { runId } : {}),
    ...(providerCallId ? { providerCallId } : {}),
  });
}

function assertCandidateIdentity(
  candidate: ContextProjectionCandidate,
  request: ContextProjectionProviderCallRequest,
  identity: ProjectionProviderCallIdentity,
): void {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    candidate.conversationId !== identity.conversationId ||
    candidate.providerCallId !== identity.providerCallId ||
    candidate.transientMessageCount !== request.transientMessageCount
  ) {
    throw new TypeError("Context Projection candidate identity is invalid");
  }
}

function assertCanonicalClassification(
  candidate: ContextProjectionCandidate,
  canonicalMessages: readonly RuntimeMessageSnapshot[],
): void {
  if (!Array.isArray(candidate.pinnedGroups) || !Array.isArray(candidate.recentMessageIds)) {
    throw new TypeError("Context Projection classification is invalid");
  }
  const classifiedIds = [
    ...candidate.pinnedGroups.flatMap((group) => group.messageIds),
    ...candidate.recentMessageIds,
  ];
  const classified = new Set(classifiedIds);
  const canonical = new Set(canonicalMessages.map((message) => message.id));
  // system.reminder 消息豁免窗口分类：它们不计入 recent 预算、不参与裁剪，
  // 由 selectedMessageIds 的强制保留兜底（见 prepare）。若 candidate 已把它们
  // 放进 pinned/recent 也无妨——分类仍是合法的。
  // system.reminder messages are exempt from window classification: they are
  // never budgeted or dropped, and retention is guaranteed by the force-select
  // in prepare(). Candidates may still classify them normally.
  const reminderIds = new Set(
    canonicalMessages
      .filter(
        (message) =>
          message.messageType === CORE_RUNTIME_MESSAGE_TYPE.systemReminder,
      )
      .map((message) => message.id),
  );
  const unclassifiedNonReminder = [...canonical].filter(
    (messageId) => !reminderIds.has(messageId) && !classified.has(messageId),
  );
  if (
    unclassifiedNonReminder.length > 0 ||
    [...classified].some((messageId) => !canonical.has(messageId))
  ) {
    throw new TypeError("Context Projection classification is incomplete");
  }
}

/**
 * 把 checkpoint 摘要构造成 compact_summary system.reminder 消息草稿。
 * Builds a compact_summary system.reminder message draft from a checkpoint overlay.
 */
function createCompactSummaryMessage(
  identity: ProjectionProviderCallIdentity,
  overlay: ContextCheckpointOverlay,
  canonicalMessages: readonly RuntimeMessageSnapshot[],
): RuntimeMessageSnapshot {
  // 时间戳从既有消息派生，保证每次调用结果确定（不破坏候选 digest）。
  // Derive the timestamp from existing messages so the candidate stays deterministic.
  const derivedTimestamp =
    canonicalMessages.length > 0
      ? canonicalMessages[canonicalMessages.length - 1]!.timestamp
      : "1970-01-01T00:00:00.000Z";
  const highestOrder = canonicalMessages.reduce(
    (max, message) =>
      message.messageType === CORE_RUNTIME_MESSAGE_TYPE.systemReminder &&
      typeof (message.payload as { order?: unknown }).order === "number"
        ? Math.max(
            max,
            (message.payload as { order: number }).order,
          )
        : max,
    0,
  );
  return {
    id: `message:compact-summary:${identity.providerCallId}`,
    conversationId: identity.conversationId,
    role: "system",
    messageType: CORE_RUNTIME_MESSAGE_TYPE.systemReminder,
    schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
    timestamp: derivedTimestamp,
    runId: identity.runId,
    payload: {
      kind: "compact_summary",
      content: overlay.content,
      order: highestOrder + 1,
    },
  };
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
