/**
 * Compose 状态机与 novel.compose.* 事件聚焦冒烟。
 * Focused smoke for the compose state machine and novel.compose.* events.
 */
import assert from "node:assert/strict";
import {
  ComposeModeStateProvider,
  ComposeStateError,
  NovelComposeOutputEvent,
  createCoreEventSchemaRegistry,
} from "../dist/index.js";

const provider = new ComposeModeStateProvider();
const conversationId = "conversation:compose-state";
const designFilePath = "/workspace/.novel/design/conversation:compose-state.md";

// idle -> designing（active）；idle 快照含默认 base mode review。
assert.deepEqual(provider.snapshot(conversationId), {
  phase: "idle",
  active: false,
  mode: "review",
});
const designing = provider.enter(conversationId, { designFilePath });
assert.equal(designing.phase, "designing");
assert.equal(designing.active, true);
assert.equal(designing.designFilePath, designFilePath);

// 激活中不可重复进入
assert.throws(
  () => provider.enter(conversationId, { designFilePath }),
  ComposeStateError,
);

// designing -> pending
const pending = provider.submit(conversationId);
assert.equal(pending.phase, "pending");
assert.equal(pending.active, true);

// pending -> designing（拒绝后修订）
const rejected = provider.reject(conversationId);
assert.equal(rejected.phase, "designing");
assert.equal(rejected.active, true);

// 重新提交 -> pending -> applied（active=false，恢复原模式）
provider.submit(conversationId);
const applied = provider.approve(conversationId);
assert.equal(applied.phase, "applied");
assert.equal(applied.active, false);

// applied 后可再次进入新一轮设计
provider.enter(conversationId, { designFilePath });
const discarded = provider.discard(conversationId);
assert.equal(discarded.phase, "discarded");
assert.equal(discarded.active, false);
provider.clear(conversationId);
assert.deepEqual(provider.snapshot(conversationId), {
  phase: "idle",
  active: false,
  mode: "review",
});

// 非法迁移抛出 ComposeStateError
assert.throws(() => provider.submit(conversationId), ComposeStateError);
assert.throws(() => provider.approve(conversationId), ComposeStateError);
assert.throws(() => provider.reject(conversationId), ComposeStateError);
assert.throws(() => provider.discard(conversationId), ComposeStateError);

// 事件构造 + schema 校验
const registry = createCoreEventSchemaRegistry();
const base = {
  id: "compose-evt-1",
  conversationId,
  timestamp: "2026-08-07T00:00:00.000Z",
};
const cases = [
  ["compose.begin", "novel.compose.begin", { designFilePath, phase: "designing" }],
  ["compose.submitted", "novel.compose.submitted", { designFilePath, phase: "pending" }],
  ["compose.approved", "novel.compose.approved", { designFilePath, phase: "applied", preComposeMode: "default" }],
  ["compose.rejected", "novel.compose.rejected", { designFilePath, phase: "designing" }],
  ["compose.applied", "novel.compose.applied", { designFilePath, phase: "applied" }],
  ["compose.discarded", "novel.compose.discarded", { designFilePath, phase: "discarded" }],
] ;
for (const [eventName, eventType, payload] of cases) {
  const event = new NovelComposeOutputEvent({
    ...base,
    eventName,
    payload,
  });
  assert.equal(event.getEventType(), eventType);
  const snapshot = event.getSnapshot();
  assert.equal(snapshot.eventType, eventType);
  assert.deepEqual(registry.validateOutput(snapshot), snapshot);
}

console.log("novel compose state smoke passed");
