import assert from "node:assert/strict";
import {
  ConversationHandleClosedError,
  ConversationHandleClosingError,
  ConversationNotFoundError,
  RUNTIME_PRESENCE_STATE,
  isRuntimePresenceState,
} from "../dist/index.js";

assert.deepEqual(Object.values(RUNTIME_PRESENCE_STATE), [
  "offline",
  "starting",
  "online",
  "stopping",
  "crashed",
]);

for (const state of Object.values(RUNTIME_PRESENCE_STATE)) {
  assert.equal(isRuntimePresenceState(state), true);
}
for (const invalid of [undefined, null, "running", "", 1, {}]) {
  assert.equal(isRuntimePresenceState(invalid), false);
}

const notFound = new ConversationNotFoundError("conversation-1");
assert.equal(notFound.name, "ConversationNotFoundError");
assert.equal(notFound.code, "CONVERSATION_NOT_FOUND");
assert.equal(notFound.conversationId, "conversation-1");

const closing = new ConversationHandleClosingError("conversation-1");
assert.equal(closing.name, "ConversationHandleClosingError");
assert.equal(closing.code, "CONVERSATION_HANDLE_CLOSING");
assert.equal(closing.conversationId, "conversation-1");

const closed = new ConversationHandleClosedError("conversation-1");
assert.equal(closed.name, "ConversationHandleClosedError");
assert.equal(closed.code, "CONVERSATION_HANDLE_CLOSED");
assert.equal(closed.conversationId, "conversation-1");

console.log("Task 2-A Conversation protocol smoke passed");
