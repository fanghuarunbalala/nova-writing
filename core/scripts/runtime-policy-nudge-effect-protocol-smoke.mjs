import assert from "node:assert/strict";
import {
  captureRuntimePolicyEffect,
  captureSystemReminderAttachEffect,
} from "../dist/index.js";

const base = {
  policyId: "policy.reminder",
  conversationId: "conversation-policy",
  runId: "run-policy",
};

const attach = captureSystemReminderAttachEffect({
  ...base,
  kind: "system_reminder_attach",
  reminderId: "novel.reminder.todo_idle",
  reminderKind: "todo_idle",
  templateId: "novel.reminder.todo_idle",
  templateVersion: "1.0.0",
  parameters: { private: "payload" },
  order: 1,
});
assert.equal(attach.kind, "system_reminder_attach");
assert.equal(attach.reminderKind, "todo_idle");
assert.equal(attach.order, 1);
assert.equal(Object.isFrozen(attach), true);
assert.equal(Object.isFrozen(attach.parameters), true);

// captureRuntimePolicyEffect 按 kind dispatch 到 system_reminder_attach。
const viaDispatch = captureRuntimePolicyEffect({
  ...base,
  kind: "system_reminder_attach",
  reminderId: "novel.reminder.compose_mode",
  reminderKind: "compose_mode",
  templateId: "novel.reminder.compose_mode",
  templateVersion: "1.0.0",
  parameters: Object.freeze({}),
  order: 2,
});
assert.equal(viaDispatch.kind, "system_reminder_attach");
assert.equal(viaDispatch.reminderKind, "compose_mode");
assert.equal(viaDispatch.order, 2);

// 无效输入拒绝：非空字段缺失 / order 负数 / reminderKind 非法。
assert.throws(() => captureSystemReminderAttachEffect({
  ...base,
  kind: "system_reminder_attach",
  reminderId: "novel.reminder.bad",
  reminderKind: "not-a-reminder-kind",
  templateId: "template.reminder",
  templateVersion: "1",
  parameters: {},
  order: 1,
}));
assert.throws(() => captureSystemReminderAttachEffect({
  ...base,
  kind: "system_reminder_attach",
  reminderId: "",
  reminderKind: "todo_idle",
  templateId: "template.reminder",
  templateVersion: "1",
  parameters: {},
  order: 1,
}));
assert.throws(() => captureSystemReminderAttachEffect({
  ...base,
  kind: "system_reminder_attach",
  reminderId: "novel.reminder.bad",
  reminderKind: "todo_idle",
  templateId: "template.reminder",
  templateVersion: "1",
  parameters: {},
  order: -1,
}));

console.log("runtime policy nudge effect protocol smoke: passed");
