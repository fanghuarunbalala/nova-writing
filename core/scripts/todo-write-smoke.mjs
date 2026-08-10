import assert from "node:assert/strict";
import { Compile } from "typebox/compile";
import {
  coreEventSchemaRegistry,
  ConversationTodoCoordinator,
  ConversationTodoProjector,
  InMemoryConversationTodoStore,
  TodoAwareRuntimeSystemPromptSource,
  TodoWriteParametersSchema,
  createTodoWriteTool,
} from "../dist/index.js";

const timestamp = "2026-08-03T00:00:00.000Z";
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
const store = new InMemoryConversationTodoStore();
const coordinator = new ConversationTodoCoordinator({
  store,
  eventSink,
  clock: { now: () => timestamp },
});
const tool = createTodoWriteTool({ writer: coordinator });
const context = {
  conversationId: "conversation-todo",
  runId: "run-todo",
  turnId: "turn-todo",
  toolCallId: "tool-call-todo-1",
  signal: new AbortController().signal,
};

assert.equal(Compile(TodoWriteParametersSchema).Check({ todos: [] }), true);
assert.equal(
  Compile(TodoWriteParametersSchema).Check({
    todos: [
      { content: "First", status: "pending", activeForm: "Firsting" },
    ],
  }),
  true,
);
assert.equal(
  Compile(TodoWriteParametersSchema).Check({
    todos: [{ id: "one", content: "First", status: "pending" }],
  }),
  false,
  "legacy id-only todo must be rejected",
);

const first = await tool.handler.execute(context, {
  todos: [
    { content: "First", status: "in_progress", activeForm: "Firsting" },
    { content: "Second", status: "pending", activeForm: "Seconding" },
  ],
}, { emit: async () => {} });
assert.deepEqual(first.details.oldTodos, []);
assert.equal(first.details.newTodos.length, 2);
assert.equal(appended.length, 1);
assert.equal(appended[0].eventType, "agent.todo.updated");
assert.equal(appended[0].payload.revision, 1);
assert.equal(appended[0].payload.todos[0].activeForm, "Firsting");

const second = await tool.handler.execute(context, {
  todos: [
    { content: "First", status: "completed", activeForm: "Firsting" },
  ],
}, { emit: async () => {} });
assert.equal(second.details.oldTodos.length, 2);
assert.equal(second.details.newTodos.length, 1);
assert.equal(second.details.newTodos[0].status, "completed");
assert.deepEqual((await store.read("conversation-todo")).todos, [
  { content: "First", status: "completed", activeForm: "Firsting" },
]);

await assert.rejects(
  tool.handler.execute(context, {
    todos: [
      { content: "First", status: "in_progress", activeForm: "Firsting" },
      { content: "Second", status: "in_progress", activeForm: "Seconding" },
    ],
  }, { emit: async () => {} }),
  (error) => error?.code === "TODO_WRITE_INVALID_ARGUMENTS",
);

const replayStore = new InMemoryConversationTodoStore();
const projector = new ConversationTodoProjector(replayStore);
assert.equal(await projector.apply(appended[0]), true);
assert.equal(await projector.apply(appended[0]), false);
assert.equal((await replayStore.read("conversation-todo")).revision, 1);

const promptSource = new TodoAwareRuntimeSystemPromptSource(
  { async resolve() { return "base prompt"; } },
  coordinator,
);
const prompt = await promptSource.resolve({ conversationId: "conversation-todo" });
assert.match(prompt, /<CURRENT_TODOS revision="2">/);
assert.match(prompt, /\[completed\] First/);

console.log("TodoWrite runtime smoke passed");
