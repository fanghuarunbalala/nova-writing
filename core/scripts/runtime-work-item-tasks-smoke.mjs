import assert from "node:assert/strict";
import {
  InMemoryWorkItemStore,
  StaticTaskListResolver,
  WorkItemCoordinator,
  WorkItemNotFoundError,
  WorkItemProjector,
  coreEventSchemaRegistry,
  defaultTaskListResolver,
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

const store = new InMemoryWorkItemStore();
const coordinator = new WorkItemCoordinator({
  store,
  eventSink,
  clock: { now: () => timestamp },
});
const base = {
  conversationId: "conversation-task",
  runId: "run-task",
  turnId: "turn-task",
  listId: "conversation-task",
};

const created = await coordinator.create({
  ...base,
  toolCallId: "tool-call-task-1",
  subject: "Outline chapter 3",
  description: "Draft the beat list",
});
assert.equal(created.revision, 1);
assert.equal(created.task.id, "task-1");
assert.equal(created.task.status, "pending");
assert.equal(appended.length, 1);
assert.equal(appended[0].eventType, "agent.tasks.updated");
assert.equal(appended[0].payload.listId, "conversation-task");
assert.equal(appended[0].payload.revision, 1);
assert.equal(appended[0].payload.nextTaskSequence, 2);

const second = await coordinator.create({
  ...base,
  toolCallId: "tool-call-task-2",
  subject: "Research timeline",
  description: "",
});
assert.equal(second.task.id, "task-2");

let tasks = await coordinator.list("conversation-task");
assert.equal(tasks.length, 2);

const updated = await coordinator.update({
  ...base,
  toolCallId: "tool-call-task-3",
  taskId: "task-1",
  status: "in_progress",
  owner: "writer-agent",
  addBlockedBy: ["task-2"],
});
assert.equal(updated.revision, 3);
assert.equal(updated.task.status, "in_progress");
assert.equal(updated.task.owner, "writer-agent");
assert.deepEqual(updated.task.blockedBy, ["task-2"]);

tasks = await coordinator.list("conversation-task", { status: "in_progress" });
assert.equal(tasks.length, 1);
assert.equal(tasks[0].id, "task-1");

const got = await coordinator.get("conversation-task", "task-2");
assert.equal(got.subject, "Research timeline");

await coordinator.update({
  ...base,
  toolCallId: "tool-call-task-4",
  taskId: "task-2",
  status: "deleted",
});
tasks = await coordinator.list("conversation-task");
assert.equal(tasks.length, 1);
tasks = await coordinator.list("conversation-task", { status: "deleted" });
assert.equal(tasks.length, 1);

await assert.rejects(
  coordinator.update({
    ...base,
    toolCallId: "tool-call-task-5",
    taskId: "task-99",
    status: "completed",
  }),
  (error) => error instanceof WorkItemNotFoundError,
);

const replayedStore = new InMemoryWorkItemStore();
const projector = new WorkItemProjector(replayedStore);
for (const snapshot of appended) {
  await projector.apply(snapshot);
}
const replay = await replayedStore.read("conversation-task");
assert.equal(replay.revision, 4);
assert.equal(replay.items.length, 2);
assert.equal(
  replay.items.find((item) => item.id === "task-1").status,
  "in_progress",
);

assert.equal(
  await defaultTaskListResolver.resolve({ conversationId: "c1" }),
  "c1",
);
assert.equal(
  await defaultTaskListResolver.resolve({
    conversationId: "c1",
    teamName: "my-team",
  }),
  "my-team",
);
assert.equal(
  await new StaticTaskListResolver((context) => context.conversationId).resolve(
    { conversationId: "c1" },
  ),
  "c1",
);

console.log("runtime-work-item-tasks-smoke: ok");
