/** Compile-time contract examples for the Work-Item Task Tools. */
import {
  InMemoryWorkItemStore,
  StaticTaskListResolver,
  WorkItemCoordinator,
  createTaskToolRegistry,
  createWorkItemTaskCreateTool,
  createWorkItemTaskGetTool,
  createWorkItemTaskListTool,
  createWorkItemTaskUpdateTool,
  type RuntimeEventSink,
} from "../src/index.js";

declare const eventSink: RuntimeEventSink;

const store = new InMemoryWorkItemStore();
const coordinator = new WorkItemCoordinator({ store, eventSink });
const resolver = new StaticTaskListResolver((context) =>
  context.teamName ?? context.conversationId,
);
const registry = createTaskToolRegistry({
  writer: coordinator,
  querier: coordinator,
  resolver,
});

void registry.require("TaskCreate").handler;
void registry.require("TaskList").handler;
void registry.require("TaskGet").handler;
void registry.require("TaskUpdate").handler;
void createWorkItemTaskCreateTool({ writer: coordinator });
void createWorkItemTaskListTool({ querier: coordinator });
void createWorkItemTaskGetTool({ querier: coordinator });
void createWorkItemTaskUpdateTool({ writer: coordinator });
