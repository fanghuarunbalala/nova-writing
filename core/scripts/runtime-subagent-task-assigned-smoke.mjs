import assert from "node:assert/strict";
import {
  CoreRuntimeInputLanePolicy,
  CoreRuntimeMessageProjector,
  ConversationProjectionStore,
  INPUT_EVENT_TYPE,
  TaskAssignedInputEvent,
  createCoreEventSchemaRegistry,
  isAgentTurnInputEventType,
} from "../dist/index.js";

const event = new TaskAssignedInputEvent({
  id: "task-assigned-event-1",
  conversationId: "conversation-child-1",
  timestamp: "2026-08-03T00:00:00.000Z",
  taskId: "task-1",
  requesterConversationId: "conversation-parent-1",
  prompt: "Plan the next chapter.",
  artifactReferences: [],
});
const snapshot = event.getSnapshot();
assert.equal(snapshot.eventType, INPUT_EVENT_TYPE.taskAssigned);
assert.equal(snapshot.priority, 1000);
assert.equal(isAgentTurnInputEventType(snapshot.eventType), true);
assert.deepEqual(snapshot.payload, {
  taskId: "task-1",
  requesterConversationId: "conversation-parent-1",
  prompt: "Plan the next chapter.",
  artifactReferences: [],
});

const registry = createCoreEventSchemaRegistry();
assert.deepEqual(registry.validateInput(snapshot), snapshot);

const persisted = {
  ...snapshot,
  direction: "input",
  sequence: 1,
  recordedAt: "2026-08-03T00:00:00.001Z",
};
const projector = new CoreRuntimeMessageProjector();
assert.deepEqual(projector.project(persisted), [
  {
    role: "user",
    messageType: "user.message",
    schemaVersion: 1,
    timestamp: "2026-08-03T00:00:00.000Z",
    payload: {
      content: [{ type: "text", text: "Plan the next chapter." }],
    },
  },
]);

const lane = new CoreRuntimeInputLanePolicy().resolve(persisted);
assert.equal(lane, "turn");

const projection = new ConversationProjectionStore({
  conversationId: "conversation-child-1",
});
assert.equal(projection.apply(persisted), "applied");
assert.deepEqual(projection.getSnapshot().userMessages, [
  {
    kind: "user-message",
    eventId: "task-assigned-event-1",
    sequence: 1,
    timestamp: "2026-08-03T00:00:00.000Z",
    text: "Plan the next chapter.",
  },
]);

console.log("runtime Subagent TaskAssigned smoke passed");
