/** Compile-time contract examples for role-bound Work-Item Tool views. */
import {
  ConversationTodoCoordinator,
  InMemoryConversationTodoStore,
  InMemoryWorkItemStore,
  WorkItemCoordinator,
  createTaskToolRegistry,
  createTodoToolRegistry,
  createWorkItemToolView,
  type RuntimeEventSink,
} from "../src/index.js";

declare const eventSink: RuntimeEventSink;

const workItems = new WorkItemCoordinator({
  store: new InMemoryWorkItemStore(),
  eventSink,
});
const todos = new ConversationTodoCoordinator({
  store: new InMemoryConversationTodoStore(),
  eventSink,
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

void mainView.require("TaskCreate");
void teamView.require("TaskUpdate");
void ephemeralView.require("TodoWrite");
