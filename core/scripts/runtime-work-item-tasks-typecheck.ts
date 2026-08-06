/** Compile-time contract examples for the Runtime work-item Task protocol. */
import {
  AgentWorkItemsUpdatedOutputEvent,
  InMemoryWorkItemStore,
  StaticTaskListResolver,
  WorkItemCoordinator,
  WorkItemProjector,
  WorkItemNotFoundError,
  defaultTaskListResolver,
  type RuntimeEventSink,
  type TaskListContext,
} from "../src/index.js";

declare const eventSink: RuntimeEventSink;
declare const taskListContext: TaskListContext;

const store = new InMemoryWorkItemStore();
const coordinator = new WorkItemCoordinator({ store, eventSink });
const projector = new WorkItemProjector(store);
const resolver = new StaticTaskListResolver((context) =>
  context.teamName ?? context.conversationId,
);

void projector;
void resolver.resolve(taskListContext);
void defaultTaskListResolver.resolve({ conversationId: "conversation-a" });
void WorkItemNotFoundError;
void AgentWorkItemsUpdatedOutputEvent;
void coordinator.list("conversation-a");
