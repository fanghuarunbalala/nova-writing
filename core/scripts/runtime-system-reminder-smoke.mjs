/**
 * system.reminder 消息层冒烟（Step 1 of PromptAssembly refactor）。
 * system.reminder message-layer smoke (Step 1 of the PromptAssembly refactor).
 *
 * 验证 / Verifies:
 * 1. system.reminder.attached 输出事件可构造，事件类型稳定；
 * 2. CoreReminderRuntimeMessageProjector 把事件投影为 system.reminder 消息草稿；
 * 3. schema registry 校验通过（kind/content/order）；
 * 4. CorePiRuntimeMessageConverter 转成 Pi user 消息并包裹 <system-reminder>；
 * 5. 保留语义：消息数量与顺序不变（不剥离、不重排，保前缀 → prefill 缓存）。
 */
import assert from "node:assert/strict";
import {
  CorePiRuntimeMessageConverter,
  PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE,
} from "../dist/runtime/agent/pi/index.js";
import {
  CoreReminderRuntimeMessageProjector,
  OUTPUT_EVENT_TYPE,
  SystemReminderAttachedOutputEvent,
  coreRuntimeMessageSchemaRegistry,
} from "../dist/index.js";

const conversationId = "conversation:reminder-smoke";
const runId = "run:1";
const turnId = "turn:1";
const REMINDER_CONTENT =
  "<CURRENT_TODOS revision=\"3\">\n- [pending] outline ch1\n- [in_progress] draft ch1\n</CURRENT_TODOS>";

// 1. 事件可构造且类型稳定 / Event is constructible and type-stable.
const event = new SystemReminderAttachedOutputEvent({
  conversationId,
  runId,
  turnId,
  reminderId: "reminder:todo-3",
  kind: "todo_reminder",
  content: REMINDER_CONTENT,
  order: 1,
  timestamp: "2026-08-06T00:00:00.000Z",
});
assert.equal(event.getEventType(), OUTPUT_EVENT_TYPE.systemReminderAttached);

// 2. 投影为消息草稿 / Project into a message draft.
const projector = new CoreReminderRuntimeMessageProjector();
const persistedEvent = {
  id: "event:reminder-3",
  conversationId,
  eventType: event.getEventType(),
  schemaVersion: 1,
  timestamp: "2026-08-06T00:00:00.000Z",
  correlationId: "corr:1",
  runId,
  turnId,
  payload: {
    reminderId: "reminder:todo-3",
    kind: "todo_reminder",
    content: REMINDER_CONTENT,
    order: 1,
  },
  direction: "output",
  sequence: 3,
  recordedAt: "2026-08-06T00:00:00.000Z",
};
const drafts = projector.project(persistedEvent);
assert.equal(drafts.length, 1);
assert.equal(drafts[0].role, "system");
assert.equal(drafts[0].messageType, "system.reminder");
assert.equal(drafts[0].payload.kind, "todo_reminder");
assert.equal(drafts[0].payload.order, 1);

// 3. schema registry 校验 / Schema registry validation.
const snapshot = coreRuntimeMessageSchemaRegistry.validateSnapshot({
  id: "message:reminder-3",
  conversationId,
  ...drafts[0],
});
assert.equal(snapshot.messageType, "system.reminder");

// 4-5. Pi 转换：包裹 <system-reminder>，数量与顺序不变 / Pi conversion wraps and preserves order.
const contextMessages = [
  {
    id: "message:user-1",
    conversationId,
    role: "user",
    messageType: "user.message",
    schemaVersion: 1,
    timestamp: "2026-08-06T00:00:01.000Z",
    runId,
    turnId,
    payload: { content: [{ type: "text", text: "hello" }] },
  },
  snapshot,
];
const converter = new CorePiRuntimeMessageConverter();
const piMessages = await converter.convert({
  conversationId,
  runId,
  purpose: PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE.prompt,
  messages: contextMessages,
});
assert.equal(piMessages.length, 2, "reminder 不得被剥离 / reminder must not be stripped");
assert.equal(piMessages[0].role, "user");
assert.equal(piMessages[1].role, "user", "reminder 以 user 角色到达 provider");
const reminderText = piMessages[1].content[0].text;
assert.ok(reminderText.startsWith('<system-reminder kind="todo_reminder">'));
assert.ok(reminderText.includes(REMINDER_CONTENT));
assert.ok(reminderText.endsWith("</system-reminder>"));

console.log("runtime-system-reminder: ok (project + validate + convert, order preserved)");
