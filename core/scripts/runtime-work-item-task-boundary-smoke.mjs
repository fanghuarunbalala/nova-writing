import assert from "node:assert/strict";
import {
  ConversationTodoCoordinator,
  InMemoryConversationTodoStore,
  InMemoryWorkItemStore,
  WorkItemCoordinator,
  WorkItemProjector,
  coreEventSchemaRegistry,
  createTaskToolRegistry,
  createTodoToolRegistry,
  createWorkItemToolView,
} from "../dist/index.js";

const timestamp = "2026-08-06T00:00:00.000Z";
const appended = [];
const eventSink = {
  async append(event) {
    const snapshot = coreEventSchemaRegistry.validateOutput(event.getSnapshot());
    appended.push(snapshot);
    return {
      status: "recorded",
      conversationId: snapshot.conversationId,
      eventId: snapshot.id,
      sequence: appended.length,
      recordedAt: timestamp,
    };
  },
};

const workItems = new WorkItemCoordinator({
  store: new InMemoryWorkItemStore(),
  eventSink,
  clock: { now: () => timestamp },
});
const todos = new ConversationTodoCoordinator({
  store: new InMemoryConversationTodoStore(),
  eventSink,
  clock: { now: () => timestamp },
});
const taskRegistry = createTaskToolRegistry({
  writer: workItems,
  querier: workItems,
});
const todoRegistry = createTodoToolRegistry({ writer: todos });

const mainView = createWorkItemToolView({
  role: "main",
  taskRegistry,
  todoRegistry,
});
const teamView = createWorkItemToolView({
  role: "team_member",
  taskRegistry,
  todoRegistry,
});
const ephemeralView = createWorkItemToolView({
  role: "ephemeral",
  taskRegistry,
  todoRegistry,
});

for (const view of [mainView, teamView]) {
  assert.equal(view.has("TaskCreate"), true);
  assert.equal(view.has("TaskList"), true);
  assert.equal(view.has("TaskGet"), true);
  assert.equal(view.has("TaskUpdate"), true);
  assert.equal(view.has("TodoWrite"), true);
}
assert.equal(ephemeralView.has("TodoWrite"), true);
assert.equal(ephemeralView.has("TaskCreate"), false);
assert.equal(ephemeralView.has("TaskList"), false);
assert.equal(ephemeralView.has("TaskGet"), false);
assert.equal(ephemeralView.has("TaskUpdate"), false);

const context = {
  conversationId: "conversation-boundary",
  runId: "run-boundary",
  turnId: "turn-boundary",
  toolCallId: "tool-call-boundary-1",
  signal: new AbortController().signal,
};

// Approval independence: Task tool execution emits only work-item events.
await mainView.require("TaskCreate").handler.execute(
  context,
  { subject: "Chapter 3 outline", description: "Beat list" },
  { emit: async () => {} },
);
await mainView.require("TaskUpdate").handler.execute(
  context,
  { taskId: "task-1", status: "in_progress", owner: "writer-agent" },
  { emit: async () => {} },
);
for (const event of appended) {
  assert.equal(event.eventType, "agent.tasks.updated");
}

// Crash/restart: the journal is the durability barrier. A fresh store that
// first received a stale projection catches up by replaying the full durable
// journal (idempotent), then the runtime continues and revision numbering
// stays consistent with a full-replay store.
const restartedStore = new InMemoryWorkItemStore();
const restartedProjector = new WorkItemProjector(restartedStore);
for (const event of appended.slice(0, appended.length - 1)) {
  await restartedProjector.apply(event);
}
for (const event of appended) {
  await restartedProjector.apply(event);
}
const restarted = new WorkItemCoordinator({
  store: restartedStore,
  eventSink,
  clock: { now: () => timestamp },
});
await restarted.create({
  conversationId: "conversation-boundary",
  listId: "conversation-boundary",
  runId: "run-boundary",
  toolCallId: "tool-call-boundary-2",
  subject: "Research timeline",
  description: "",
});

const fullStore = new InMemoryWorkItemStore();
const fullProjector = new WorkItemProjector(fullStore);
for (const event of appended) {
  await fullProjector.apply(event);
}
const afterRestart = await restartedStore.read("conversation-boundary");
const fullReplay = await fullStore.read("conversation-boundary");
assert.equal(afterRestart.revision, fullReplay.revision);
assert.equal(afterRestart.items.length, fullReplay.items.length);
assert.deepEqual(
  afterRestart.items.map((item) => item.id),
  fullReplay.items.map((item) => item.id),
);
assert.equal(afterRestart.items.length, 2);

// Duplicate/older event replay is idempotent.
const before = await fullStore.read("conversation-boundary");
await fullProjector.apply(appended[0]);
const after = await fullStore.read("conversation-boundary");
assert.equal(after.revision, before.revision);

console.log("runtime-work-item-task-boundary-smoke: ok");
