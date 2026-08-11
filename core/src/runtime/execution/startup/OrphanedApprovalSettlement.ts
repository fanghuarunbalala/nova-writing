/**
 * 新 runtime 实例启动时结算上一实例遗留的挂起审批：
 * 所属 runtimeInstanceId ≠ 当前实例 且尚未有 resolved 的 approval →
 * 追加 tool.approval.resolved(expired) + 合成 tool.result.recorded(failed, "进程死亡，审批已结束")，
 * 使前端双工投影收到终止、后续上下文重建包含失败的 tool result，避免工具调用永久悬空。
 *
 * Settles approvals orphaned by a previous runtime instance: for every requested
 * approval whose owning runtimeInstanceId differs from the current instance and
 * that has no matching resolved event, append an expired resolution plus a
 * synthetic failed tool result. Deterministic event ids make re-runs idempotent
 * (duplicate appends are dropped by the journal).
 */
import { OUTPUT_EVENT_TYPE } from "../../../event/output/OutputEventType.js";
import {
  ToolApprovalResolvedOutputEvent,
  ToolResultRecordedOutputEvent,
} from "../../../event/output/index.js";
import type { PersistedOutputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import type { ConversationJournalReader } from "../../../storage/journal/ConversationJournalStore.js";
import {
  DEFAULT_APPROVAL_EVENT_ID_FACTORY,
  type ToolApprovalEventIdFactory,
} from "../../interaction/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { RuntimeEventSink } from "../event/RuntimeEventSink.js";

/** 进程死亡导致审批作废的合成结果错误码。 */
export const ORPHANED_APPROVAL_ERROR_CODE = "TOOL_PROCESS_DEATH";

/** 合成 tool result 中给模型/前端的人类可读消息。 */
export const ORPHANED_APPROVAL_RESULT_MESSAGE = "进程死亡，审批已结束";

/** 合成 tool result 的确定性事件 id（与正常执行结果同前缀，跨重启幂等）。 */
function orphanedToolResultEventId(toolCallId: string): string {
  return `evt_tool_result_${toolCallId}`;
}

export interface OrphanedApprovalSettlementOptions {
  readonly conversationId: string;
  /** 当前 child runtime 实例 id；不等于它的挂起审批视为上一实例遗留。 */
  readonly currentRuntimeInstanceId: string;
  readonly journal: ConversationJournalReader;
  readonly eventSink: RuntimeEventSink;
  readonly eventIdFactory?: ToolApprovalEventIdFactory;
  readonly logger?: Logger;
}

export interface OrphanedApprovalSettlementResult {
  readonly conversationId: string;
  readonly settledCount: number;
  /** 每条已结算审批的标识，供日志/断言。 */
  readonly settled: readonly {
    readonly approvalRequestId: string;
    readonly toolCallId: string;
    readonly toolName: string;
  }[];
}

/**
 * 结算上一 runtime 实例遗留的挂起审批。幂等：已存在 resolved 事件的跳过；
 * 事件 id 确定性生成，重复执行由 journal 去重。best-effort：失败仅记录，
 * 不阻塞 runtime 启动（已结算的条目下次启动仍可补结）。
 */
export async function settleOrphanedApprovals(
  options: OrphanedApprovalSettlementOptions,
): Promise<OrphanedApprovalSettlementResult> {
  const logger = (options.logger ?? noopLogger).child({
    component: "orphaned_approval_settlement",
    conversationId: options.conversationId,
  });
  const eventIdFactory =
    options.eventIdFactory ?? DEFAULT_APPROVAL_EVENT_ID_FACTORY;

  const requested = await listApprovalEvents(
    options.journal,
    options.conversationId,
    OUTPUT_EVENT_TYPE.toolApprovalRequested,
  );
  const resolved = await listApprovalEvents(
    options.journal,
    options.conversationId,
    OUTPUT_EVENT_TYPE.toolApprovalResolved,
  );
  const resolvedIds = new Set(
    resolved.map((event) => readApprovalRequestId(event)),
  );

  const settled: {
    readonly approvalRequestId: string;
    readonly toolCallId: string;
    readonly toolName: string;
  }[] = [];
  for (const event of requested) {
    const approvalRequestId = readApprovalRequestId(event);
    if (approvalRequestId === "") {
      logger.warn("orphaned_approval.skipped_missing_id", { eventId: event.id });
      continue;
    }
    if (resolvedIds.has(approvalRequestId)) continue;
    if (event.payload.runtimeInstanceId === options.currentRuntimeInstanceId) {
      continue;
    }
    const record = captureOrphanedRequest(event);
    if (record === undefined) {
      logger.warn("orphaned_approval.skipped_invalid_request", {
        approvalRequestId,
        eventId: event.id,
      });
      continue;
    }
    const resolvedAt = new Date().toISOString();
    await options.eventSink.append(
      new ToolApprovalResolvedOutputEvent({
        conversationId: options.conversationId,
        id: eventIdFactory.resolved(approvalRequestId),
        runId: record.runId,
        ...(record.turnId === undefined ? {} : { turnId: record.turnId }),
        approvalRequestId,
        toolCallId: record.toolCallId,
        toolName: record.toolName,
        toolVersion: record.toolVersion,
        argumentDigest: record.argumentDigest,
        decision: "expired",
        resolvedAt,
      }),
    );
    await options.eventSink.append(
      new ToolResultRecordedOutputEvent({
        id: orphanedToolResultEventId(record.toolCallId),
        record: Object.freeze({
          conversationId: options.conversationId,
          runId: record.runId,
          ...(record.turnId === undefined ? {} : { turnId: record.turnId }),
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          toolVersion: record.toolVersion,
          outcome: "failed",
          errorCode: ORPHANED_APPROVAL_ERROR_CODE,
          result: { text: ORPHANED_APPROVAL_RESULT_MESSAGE },
          truncated: false,
        }),
      }),
    );
    settled.push({
      approvalRequestId,
      toolCallId: record.toolCallId,
      toolName: record.toolName,
    });
    logger.info("orphaned_approval.settled", {
      approvalRequestId,
      toolCallId: record.toolCallId,
      toolName: record.toolName,
    });
  }

  const result: OrphanedApprovalSettlementResult = Object.freeze({
    conversationId: options.conversationId,
    settledCount: settled.length,
    settled: Object.freeze([...settled]),
  });
  logger.info("orphaned_approval.completed", {
    requestedCount: requested.length,
    resolvedCount: resolved.length,
    settledCount: result.settledCount,
  });
  return result;
}

async function listApprovalEvents(
  journal: ConversationJournalReader,
  conversationId: string,
  eventType: string,
): Promise<readonly PersistedOutputEventSnapshot[]> {
  const events: PersistedOutputEventSnapshot[] = [];
  let cursor = 0;
  let hasNext = true;
  while (hasNext) {
    const page = await journal.list({
      conversationId,
      anchor: { afterSequence: cursor },
      direction: "output",
      eventTypes: [eventType],
      limit: 500,
    });
    for (const event of page.events) {
      if (event.direction === "output") events.push(event);
    }
    hasNext = page.hasNext;
    const lastSequence = page.events.at(-1)?.sequence;
    if (lastSequence === undefined) break;
    cursor = lastSequence;
  }
  return events;
}

function readApprovalRequestId(event: PersistedOutputEventSnapshot): string {
  const value = event.payload?.approvalRequestId;
  return typeof value === "string" && value.length > 0 ? value : "";
}

interface OrphanedApprovalRequestRecord {
  readonly runId: string;
  readonly turnId?: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly argumentDigest: `sha256:${string}`;
}

function captureOrphanedRequest(
  event: PersistedOutputEventSnapshot,
): OrphanedApprovalRequestRecord | undefined {
  const payload = event.payload ?? {};
  const runId = event.runId;
  const turnId = event.turnId;
  const toolCallId = payload.toolCallId;
  const toolName = payload.toolName;
  const toolVersion = payload.toolVersion;
  const argumentDigest = payload.argumentDigest;
  if (
    typeof runId !== "string" ||
    runId.length === 0 ||
    typeof toolCallId !== "string" ||
    toolCallId.length === 0 ||
    typeof toolName !== "string" ||
    toolName.length === 0 ||
    typeof toolVersion !== "string" ||
    toolVersion.length === 0 ||
    typeof argumentDigest !== "string" ||
    argumentDigest.length === 0 ||
    !argumentDigest.startsWith("sha256:")
  ) {
    return undefined;
  }
  return {
    runId,
    ...(typeof turnId === "string" && turnId.length > 0 ? { turnId } : {}),
    toolCallId,
    toolName,
    toolVersion,
    argumentDigest: argumentDigest as `sha256:${string}`,
  };
}
