/**
 * 过期审批清扫冒烟：超过 expiresAt 的挂起审批被周期 sweep 结算为 expired，
 * 内存释放（pending 清空）、promise 以 expired 决议；start/stop 管理定时器。
 */
import assert from "node:assert/strict";
import {
  ApprovalDecisionInputEvent,
  ApprovalExpirySweeper,
  InMemoryInteractionCoordinator,
  OUTPUT_EVENT_TYPE,
} from "../dist/index.js";

class CollectingSink {
  constructor() { this.events = []; }
  async append(event) {
    this.events.push(event);
    return {
      status: "recorded",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.events.length,
      recordedAt: event.timestamp,
    };
  }
}

const digest = `sha256:${"a".repeat(64)}`;
const sink = new CollectingSink();
const coordinator = new InMemoryInteractionCoordinator({ eventSink: sink });

let now = "2026-08-07T02:00:00.000Z";
const clock = { now: () => now };
const sweeper = new ApprovalExpirySweeper({
  coordinator,
  clock,
  intervalMs: 1_000,
});

// 未过期审批：sweep 不清结。
const pendingFuture = coordinator.request(request("approval-future", "call-future", "2026-08-07T03:00:00.000Z"));
const pendingPast = coordinator.request(request("approval-past", "call-past", "2026-08-07T01:00:00.000Z"));
await sweeper.sweep();
assert.equal((await coordinator.listPending()).length, 1);

// 已过期审批：sweep 清结为 expired；未过期的仍在 pending（上面 listPending=1）。
assert.equal((await pendingPast).decision, "expired");

// 时钟推进到全部过期后，再 sweep 清结剩余。
now = "2026-08-07T04:00:00.000Z";
await sweeper.sweep();
assert.equal((await coordinator.listPending()).length, 0);
assert.equal((await pendingFuture).decision, "expired");

const resolvedEvents = sink.events
  .map((event) => event.getSnapshot())
  .filter((event) => event.eventType === OUTPUT_EVENT_TYPE.toolApprovalResolved);
assert.equal(resolvedEvents.length, 2);
for (const resolvedEvent of resolvedEvents) {
  assert.equal(resolvedEvent.payload.decision, "expired");
}
assert.deepEqual(
  resolvedEvents.map((event) => event.payload.approvalRequestId).sort(),
  ["approval-future", "approval-past"],
);

// start/stop：重复 start 幂等；stop 后清空定时器。
sweeper.start();
sweeper.start();
sweeper.stop();

// 已决议(非 expire)审批不被重复清结：resolve 后 pending 已移除，sweep 不再发事件。
const sink2 = new CollectingSink();
const coordinator2 = new InMemoryInteractionCoordinator({ eventSink: sink2 });
const sweeper2 = new ApprovalExpirySweeper({
  coordinator: coordinator2,
  clock,
  intervalMs: 1_000,
});
const early = coordinator2.request(request("approval-early", "call-early", "2026-08-07T01:00:00.000Z"));
const decisionEvent = new ApprovalDecisionInputEvent({
  id: "input-early",
  conversationId: "conversation-sweep",
  runId: "run-call-early",
  turnId: "turn-call-early",
  timestamp: "2026-08-07T02:00:01.000Z",
  approvalRequestId: "approval-early",
  decision: "approved",
  argumentDigest: digest,
});
await coordinator2.resolve({
  ...decisionEvent.getSnapshot(),
  direction: "input",
  sequence: 1,
  recordedAt: decisionEvent.timestamp,
}, { actorId: "local_user" });
assert.equal((await early).decision, "approved");
await sweeper2.sweep();
const sink2Resolved = sink2.events
  .map((event) => event.getSnapshot())
  .filter((event) => event.eventType === OUTPUT_EVENT_TYPE.toolApprovalResolved);
assert.equal(sink2Resolved.length, 1, "已决议审批不被重复清结");

console.log("tool approval expiry sweep smoke passed");

function request(approvalRequestId, toolCallId, expiresAt) {
  return {
    approvalRequestId,
    identity: {
      conversationId: "conversation-sweep",
      runId: `run-${toolCallId}`,
      toolCallId,
      toolName: "NovelParagraphWrite",
      toolVersion: "1.0.0",
      argumentDigest: digest,
    },
    turnId: `turn-${toolCallId}`,
    runtimeInstanceId: "runtime-instance-smoke",
    summary: { title: "新增段落" },
    requestedAt: "2026-08-07T00:00:00.000Z",
    expiresAt,
  };
}
