/**
 * 跨进程审批作废结算冒烟：
 * 新实例启动 → 上一实例遗留的挂起审批被终止（resolved expired + 合成 tool.result failed），
 * 同实例挂起不动、已结算跳过、多 pending 逐条、重复执行幂等。
 */
import assert from "node:assert/strict";
import {
  DEFAULT_APPROVAL_EVENT_ID_FACTORY,
  ORPHANED_APPROVAL_ERROR_CODE,
  ORPHANED_APPROVAL_RESULT_MESSAGE,
  OUTPUT_EVENT_TYPE,
  ToolApprovalRequestedOutputEvent,
  ToolApprovalResolvedOutputEvent,
  settleOrphanedApprovals,
} from "../dist/index.js";

const conversationId = "conversation-orphaned";
const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const digestC = `sha256:${"c".repeat(64)}`;
const digestD = `sha256:${"d".repeat(64)}`;
const currentInstance = "instance-current";
const oldInstance = "instance-old";
const logs = [];

class CollectingLogger {
  constructor(entries = []) { this.entries = entries; }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child() { return this; }
  record(level, event, fields) { this.entries.push({ level, event, fields }); }
}

class SharedStore {
  constructor() {
    this.records = [];
    this.nextSequence = 0;
  }
  append(snapshot) {
    this.nextSequence += 1;
    const record = Object.freeze({
      ...snapshot,
      direction: "output",
      sequence: this.nextSequence,
      recordedAt: snapshot.timestamp,
    });
    this.records.push(record);
    return {
      status: "recorded",
      conversationId: snapshot.conversationId,
      eventId: snapshot.id,
      sequence: this.nextSequence,
      recordedAt: snapshot.timestamp,
    };
  }
}

class StoreJournal {
  constructor(store) { this.store = store; }
  async getHighWatermark() { return this.store.records.at(-1)?.sequence ?? 0; }
  async getBySequence() { return undefined; }
  async getByEventId() { return undefined; }
  async list(query) {
    const records = this.store.records.filter((record) => {
      if (record.conversationId !== query.conversationId) return false;
      if (query.direction !== undefined && record.direction !== query.direction) return false;
      if (query.eventTypes !== undefined && !query.eventTypes.includes(record.eventType)) return false;
      if ("afterSequence" in query.anchor && record.sequence <= query.anchor.afterSequence) return false;
      if (query.throughSequence !== undefined && record.sequence > query.throughSequence) return false;
      return true;
    });
    records.sort((a, b) => a.sequence - b.sequence);
    const highWatermark = this.store.records.at(-1)?.sequence ?? 0;
    const events = records.slice(0, query.limit ?? 500);
    const lastSequence = events.at(-1)?.sequence;
    const hasNext = lastSequence === undefined
      ? false
      : records.some((record) => record.sequence > lastSequence);
    return Object.freeze({
      events: Object.freeze(events),
      highWatermark,
      hasPrevious: false,
      hasNext,
    });
  }
}

class StoreEventSink {
  constructor(store) { this.store = store; }
  async append(event) {
    return this.store.append(event.getSnapshot());
  }
}

const store = new SharedStore();
const journal = new StoreJournal(store);
const eventSink = new StoreEventSink(store);
const logger = new CollectingLogger(logs);

// 种子事件：
// - 旧实例挂起审批 A（应被结算）
// - 当前实例挂起审批 B（不应结算）
// - 已结算审批 C（requested + resolved，应跳过）
// - 旧实例挂起审批 D（应被结算，与 A 一起逐条结算）
function requested(instance, approvalRequestId, toolCallId, digest) {
  return new ToolApprovalRequestedOutputEvent({
    conversationId,
    id: DEFAULT_APPROVAL_EVENT_ID_FACTORY.requested(approvalRequestId),
    runId: `run-${toolCallId}`,
    turnId: `turn-${toolCallId}`,
    runtimeInstanceId: instance,
    approvalRequestId,
    toolCallId,
    toolName: "NovelParagraphWrite",
    toolVersion: "1.0.0",
    argumentDigest: digest,
    summary: { title: "新增段落" },
    requestedAt: "2026-08-07T01:00:00.000Z",
    expiresAt: "2026-08-07T01:15:00.000Z",
  });
}
function resolved(approvalRequestId, toolCallId, digest, decision) {
  return new ToolApprovalResolvedOutputEvent({
    conversationId,
    id: DEFAULT_APPROVAL_EVENT_ID_FACTORY.resolved(approvalRequestId),
    runId: `run-${toolCallId}`,
    turnId: `turn-${toolCallId}`,
    approvalRequestId,
    toolCallId,
    toolName: "NovelParagraphWrite",
    toolVersion: "1.0.0",
    argumentDigest: digest,
    decision,
    actorId: "smoke-user",
    resolvedAt: "2026-08-07T01:01:00.000Z",
  });
}

for (const event of [
  requested(oldInstance, "approval-a", "call-a", digestA),
  requested(currentInstance, "approval-b", "call-b", digestB),
  requested(oldInstance, "approval-c", "call-c", digestC),
  resolved("approval-c", "call-c", digestC, "approved"),
  requested(oldInstance, "approval-d", "call-d", digestD),
]) {
  store.append(event.getSnapshot());
}

const first = await settleOrphanedApprovals({
  conversationId,
  currentRuntimeInstanceId: currentInstance,
  journal,
  eventSink,
  logger,
});
assert.equal(first.settledCount, 2);
assert.deepEqual(
  first.settled.map((item) => item.approvalRequestId).sort(),
  ["approval-a", "approval-d"],
);

const recorded = store.records.map((record) => ({
  eventType: record.eventType,
  id: record.id,
  payload: record.payload,
}));
const resolvedExpired = recorded.filter((record) =>
  record.eventType === OUTPUT_EVENT_TYPE.toolApprovalResolved &&
  record.payload.decision === "expired");
assert.equal(resolvedExpired.length, 2);
const expiredByRequest = new Map(
  resolvedExpired.map((record) => [record.payload.approvalRequestId, record]),
);
assert.deepEqual(expiredByRequest.get("approval-a").payload.toolCallId, "call-a");
assert.deepEqual(expiredByRequest.get("approval-d").payload.toolCallId, "call-d");
// 已结算的 approval-c 不被重复 resolved。
assert.equal(recorded.some((record) =>
  record.id === DEFAULT_APPROVAL_EVENT_ID_FACTORY.resolved("approval-c") &&
  record !== undefined), true);
// 当前实例 approval-b 无 expired。
assert.equal(recorded.some((record) =>
  record.eventType === OUTPUT_EVENT_TYPE.toolApprovalResolved &&
  record.payload.approvalRequestId === "approval-b"), false);

const syntheticResults = recorded.filter((record) =>
  record.eventType === OUTPUT_EVENT_TYPE.toolResultRecorded &&
  record.payload.errorCode === ORPHANED_APPROVAL_ERROR_CODE);
assert.equal(syntheticResults.length, 2);
for (const record of syntheticResults) {
  assert.equal(record.payload.outcome, "failed");
  assert.equal(record.payload.result.text, ORPHANED_APPROVAL_RESULT_MESSAGE);
  assert.equal(record.payload.truncated, false);
}
assert.equal(
  recorded.some((record) =>
    record.id === "evt_tool_result_call-b"),
  false,
  "当前实例审批不应生成合成 tool.result",
);

// 幂等：第二次执行，挂起审批均已 resolved → 不再结算。
const second = await settleOrphanedApprovals({
  conversationId,
  currentRuntimeInstanceId: currentInstance,
  journal,
  eventSink,
  logger,
});
assert.equal(second.settledCount, 0);

console.log("runtime orphaned approval settle smoke passed");
