/** Compile-time contract examples for the Runtime TodoWrite Tool. */
import {
  ConversationTodoCoordinator,
  InMemoryConversationTodoStore,
  TodoAwareRuntimeSystemPromptSource,
  TodoWriteParametersSchema,
  createTodoToolRegistry,
  createTodoWriteTool,
  type RuntimeEventSink,
} from "../src/index.js";

declare const eventSink: RuntimeEventSink;

const coordinator = new ConversationTodoCoordinator({
  store: new InMemoryConversationTodoStore(),
  eventSink,
});
const tool = createTodoWriteTool({ writer: coordinator });
const registry = createTodoToolRegistry({ writer: coordinator });
void tool.descriptor.parameters;
void registry.require("TodoWrite").handler;
void TodoWriteParametersSchema;

const promptSource = new TodoAwareRuntimeSystemPromptSource(
  { async resolve() { return "base"; } },
  coordinator,
);
void promptSource;
