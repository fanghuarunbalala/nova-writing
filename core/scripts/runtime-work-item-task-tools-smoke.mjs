import assert from "node:assert/strict";
import { Compile } from "typebox/compile";
import {
  InMemoryWorkItemStore,
  StaticTaskListResolver,
  ToolError,
  WorkItemCoordinator,
  coreEventSchemaRegistry,
  createTaskToolRegistry,
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
const registry = createTaskToolRegistry({
  writer: coordinator,
  querier: coordinator,
});
const context = {
  conversationId: "conversation-task-tools",
  runId: "run-task-tools",
  turnId: "turn-task-tools",
  toolCallId: "tool-call-task-tools-1",
  signal: new AbortController().signal,
};

const create = registry.require("TaskCreate");
const list = registry.require("TaskList");
const get = registry.require("TaskGet");
const update = registry.require("TaskUpdate");

const first = await create.handler.execute(
  context,
  { subject: "Outline chapter 3", description: "Draft the beat list" },
  { emit: async () => {} },
);
assert.equal(first.details.taskId, "task-1");
assert.equal(first.details.status, "pending");
assert.equal(appended.length, 1);
assert.equal(appended[0].eventType, "agent.tasks.updated");
assert.equal(appended[0].payload.listId, "conversation-task-tools");

await create.handler.execute(
  { ...context, toolCallId: "tool-call-task-tools-2" },
  { subject: "Research timeline", description: "" },
  { emit: async () => {} },
);

let listed = await list.handler.execute(
  context,
  {},
  { emit: async () => {} },
);
assert.equal(listed.details.total, 2);

const got = await get.handler.execute(
  context,
  { taskId: "task-1" },
  { emit: async () => {} },
);
assert.equal(got.details.task.subject, "Outline chapter 3");

const updated = await update.handler.execute(
  context,
  {
    taskId: "task-1",
    status: "in_progress",
    owner: "writer-agent",
    addBlockedBy: ["task-2"],
  },
  { emit: async () => {} },
);
assert.equal(updated.details.revision, 3);
assert.equal(updated.details.task.status, "in_progress");
assert.equal(updated.details.task.owner, "writer-agent");
assert.deepEqual(updated.details.task.blockedBy, ["task-2"]);

listed = await list.handler.execute(
  context,
  { status: "in_progress" },
  { emit: async () => {} },
);
assert.equal(listed.details.total, 1);
assert.equal(listed.details.tasks[0].id, "task-1");

await assert.rejects(
  get.handler.execute(context, { taskId: "task-99" }, { emit: async () => {} }),
  (error) =>
    error instanceof ToolError && error.code === "TASK_NOT_FOUND",
);
await assert.rejects(
  update.handler.execute(
    context,
    { taskId: "task-99", status: "completed" },
    { emit: async () => {} },
  ),
  (error) =>
    error instanceof ToolError && error.code === "TASK_NOT_FOUND",
);
await assert.rejects(
  create.handler.execute(
    context,
    { subject: "", description: "" },
    { emit: async () => {} },
  ),
  (error) =>
    error instanceof ToolError &&
    error.code === "TASK_CREATE_INVALID_ARGUMENTS",
);

assert.equal(Compile(create.descriptor.parameters).Check({ subject: "", description: "" }), false);
assert.equal(
  Compile(create.descriptor.parameters).Check({
    subject: "Task",
    description: "",
  }),
  true,
);

const teamStore = new InMemoryWorkItemStore();
const teamCoordinator = new WorkItemCoordinator({
  store: teamStore,
  eventSink,
  clock: { now: () => timestamp },
});
const teamRegistry = createTaskToolRegistry({
  writer: teamCoordinator,
  querier: teamCoordinator,
  resolver: new StaticTaskListResolver((ctx) => ctx.teamName ?? ctx.conversationId),
});
const teamContext = { ...context, conversationId: "conversation-member" };
await teamRegistry.require("TaskCreate").handler.execute(
  teamContext,
  { subject: "Shared work", description: "Team list item" },
  { emit: async () => {} },
);
assert.equal(appended[appended.length - 1].payload.listId, "conversation-member");

console.log("runtime-work-item-task-tools-smoke: ok");
