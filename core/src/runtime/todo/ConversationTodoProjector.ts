/** Rebuilds the current Todo projection from durable AgentTodoUpdated events. */
import type { OutputEventSnapshot } from "../../event/output/OutputEventSnapshot.js";
import { OUTPUT_EVENT_TYPE } from "../../event/output/OutputEventType.js";
import type {
  ConversationTodoSnapshot,
  ConversationTodoStore,
} from "./TodoProtocol.js";
import {
  captureConversationTodoSnapshot,
  captureTodoItems,
} from "./TodoProtocolValidator.js";

export class ConversationTodoProjector {
  constructor(private readonly store: ConversationTodoStore) {}

  async apply(event: OutputEventSnapshot): Promise<boolean> {
    if (event.eventType !== OUTPUT_EVENT_TYPE.agentTodoUpdated) return false;
    const payload = event.payload;
    const snapshot = captureConversationTodoSnapshot({
      conversationId: event.conversationId,
      revision: payload.revision,
      todos: captureTodoItems(payload.todos),
      updatedAt: payload.updatedAt,
      ...(event.runId === undefined ? {} : { lastUpdatedRunId: event.runId }),
    });
    const current = await this.store.read(snapshot.conversationId);
    if (current !== undefined && current.revision >= snapshot.revision) {
      return false;
    }
    await this.store.save(snapshot);
    return true;
  }
}
