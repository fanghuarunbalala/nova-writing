/**
 * TodoPromptContributor todo_reminder 消息构造冒烟（Step 4a of PromptAssembly refactor）。
 * TodoPromptContributor todo_reminder message smoke (Step 4a of the PromptAssembly refactor).
 *
 * 验证 / Verifies:
 * 1. buildReminderMessage 产出 system.reminder 草稿（kind=todo_reminder、content 含 <CURRENT_TODOS>、order 保留）；
 * 2. schema registry 校验通过；
 * 3. 空 todo 返回 null；
 * 4. 旧 appendSnapshot overlay 路径保持不变（兼容）。
 */
import assert from "node:assert/strict";
import {
  TODO_STATUS,
  TodoPromptContributor,
  coreRuntimeMessageSchemaRegistry,
} from "../dist/index.js";

const conversationId = "conversation:todo-reminder";
const runId = "run:1";
const snapshot = {
  conversationId,
  revision: 3,
  todos: [
    { content: "outline ch1", status: TODO_STATUS.pending, activeForm: "outlining ch1" },
    { content: "draft ch1", status: TODO_STATUS.inProgress, activeForm: "drafting ch1" },
  ],
  updatedAt: "2026-08-06T00:00:00.000Z",
};

const contributor = new TodoPromptContributor({
  read: async () => snapshot,
});

// 1-2. reminder 消息构造 + schema 校验。
const draft = contributor.buildReminderMessage({
  conversationId,
  runId,
  reminderId: "reminder:todo-3",
  order: 1,
  timestamp: "2026-08-06T00:00:00.000Z",
}, snapshot);
assert.ok(draft !== null);
assert.equal(draft.role, "system");
assert.equal(draft.messageType, "system.reminder");
assert.equal(draft.payload.kind, "todo_reminder");
assert.equal(draft.payload.order, 1);
assert.ok(draft.payload.content.includes('<CURRENT_TODOS revision="3">'));
assert.ok(draft.payload.content.includes("- [in_progress] draft ch1"));
const validated = coreRuntimeMessageSchemaRegistry.validateDraft(draft);
assert.equal(validated.messageType, "system.reminder");

// 3. 空 todo → null。
assert.equal(
  contributor.buildReminderMessage({
    conversationId,
    runId,
    reminderId: "reminder:todo-0",
    order: 1,
    timestamp: "2026-08-06T00:00:00.000Z",
  }, { ...snapshot, todos: [] }),
  null,
);

// 4. 旧 overlay 路径不变。
const overlayText = contributor.appendSnapshot("base-prompt", snapshot);
assert.ok(overlayText.startsWith("base-prompt"));
assert.ok(overlayText.includes("<CURRENT_TODOS revision=\"3\">"));

console.log("runtime-todo-reminder: ok (draft built, validated, empty -> null, legacy overlay intact)");
