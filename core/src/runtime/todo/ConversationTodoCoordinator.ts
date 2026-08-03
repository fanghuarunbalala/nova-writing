/** Journal-first Todo writer that emits a complete immutable OutputEvent snapshot. */
import { AgentTodoUpdatedOutputEvent } from "../../event/output/AgentTodoUpdatedOutputEvent.js";
import type { RuntimeEventSink } from "../execution/event/RuntimeEventSink.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  ConversationTodoReader,
  ConversationTodoSnapshot,
  ConversationTodoStore,
  ConversationTodoWriteRequest,
  ConversationTodoWriteResult,
  ConversationTodoWriter,
} from "./TodoProtocol.js";
import {
  captureConversationTodoSnapshot,
  captureTodoItems,
} from "./TodoProtocolValidator.js";

export interface ConversationTodoCoordinatorOptions {
  readonly store: ConversationTodoStore;
  readonly eventSink: RuntimeEventSink;
  readonly clock?: { now(): string };
  readonly logger?: Logger;
}

export class ConversationTodoCoordinator
  implements ConversationTodoReader, ConversationTodoWriter
{
  readonly #store: ConversationTodoStore;
  readonly #eventSink: RuntimeEventSink;
  readonly #clock: { now(): string };
  readonly #logger: Logger;

  constructor(options: ConversationTodoCoordinatorOptions) {
    this.#store = options.store;
    this.#eventSink = options.eventSink;
    this.#clock = options.clock ?? SYSTEM_CLOCK;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "conversation_todo_coordinator",
    });
  }

  read(conversationId: string): Promise<ConversationTodoSnapshot | undefined> {
    return this.#store.read(conversationId);
  }

  async replace(
    request: ConversationTodoWriteRequest,
  ): Promise<ConversationTodoWriteResult> {
    const conversationId = requireIdentity(request.conversationId);
    const runId = requireIdentity(request.runId);
    const toolCallId = requireIdentity(request.toolCallId);
    const todos = captureTodoItems(request.todos);
    const previous = await this.#store.read(conversationId);
    const snapshot = captureConversationTodoSnapshot({
      conversationId,
      revision: (previous?.revision ?? 0) + 1,
      todos,
      updatedAt: this.#clock.now(),
    });
    const event = new AgentTodoUpdatedOutputEvent({
      conversationId,
      runId,
      toolCallId,
      ...(request.turnId === undefined ? {} : { turnId: request.turnId }),
      revision: snapshot.revision,
      todos: snapshot.todos,
      updatedAt: snapshot.updatedAt,
    });
    const receipt = await this.#eventSink.append(event);
    await this.#store.save(snapshot);
    this.#logger.info("runtime.todo.replaced", {
      conversationId,
      runId,
      toolCallId,
      revision: snapshot.revision,
      todoCount: snapshot.todos.length,
      eventSequence: receipt.sequence,
    });
    return Object.freeze({ snapshot, eventSequence: receipt.sequence });
  }
}

const SYSTEM_CLOCK = Object.freeze({
  now: () => new Date().toISOString(),
});

function requireIdentity(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Todo identity is invalid");
  }
  return value;
}
