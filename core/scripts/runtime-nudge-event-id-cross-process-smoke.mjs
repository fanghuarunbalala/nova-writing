/**
 * nudge 生命周期事件 id 跨进程唯一性冒烟。
 * 回归：ChildNudgeLifecycleEventIdFactory 曾用进程内 #count 计数，进程重启后
 * 归零 → 同 nudge 重交付生成相同 event id → journal append 冲突
 * （JournalEventConflictError）→ run crash。现基于 providerCallId（每次 provider
 * call 唯一，跨进程也唯一）生成无状态 id。
 */
import assert from "node:assert/strict";
import { ChildNudgeLifecycleEventIdFactory } from "../dist/node/index.js";

const base = {
  conversationId: "conversation-a10dd26f",
  eventType: "system.reminder.injected",
  nudgeId: "novel.reminder.compose_mode",
};

// 进程 A 与进程 B（重启后重交付同一 nudge）：旧实现两进程都生成
// nudge_event_${nudgeId}_1（#count 从 0 起步）→ 相同 id → 碰撞。
const processA = new ChildNudgeLifecycleEventIdFactory();
const processB = new ChildNudgeLifecycleEventIdFactory();
const idProcessA = processA.create({
  ...base,
  runId: "run-AAAA",
  providerCallId: "provider_call_aaaa",
});
const idProcessB = processB.create({
  ...base,
  runId: "run-BBBB",
  providerCallId: "provider_call_bbbb",
});
assert.notEqual(idProcessA, idProcessB, "重启后同 nudge 重交付的 event id 必须不同");
assert.ok(idProcessA.startsWith("nudge_event_novel.reminder.compose_mode_"));
assert.equal(
  idProcessA,
  "nudge_event_novel.reminder.compose_mode_provider_call_aaaa",
);

// 同一 provider call 内不同 nudge 交付 → 不同 id。
const todoId = processA.create({
  ...base,
  nudgeId: "novel.reminder.todo_idle",
  runId: "run-AAAA",
  providerCallId: "provider_call_aaaa",
});
assert.notEqual(todoId, idProcessA);

// 同一 (nudgeId, providerCallId) 重复调用 → 幂等（确定性，无状态）。
const idempotent = processA.create({
  ...base,
  runId: "run-AAAA",
  providerCallId: "provider_call_aaaa",
});
assert.equal(idempotent, idProcessA);

console.log("runtime nudge event-id cross-process smoke: passed");
