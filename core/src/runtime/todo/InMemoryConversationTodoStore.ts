/** Process-local Todo projection used by tests and lightweight Runtime hosts. */
import type {
  ConversationTodoSnapshot,
  ConversationTodoStore,
} from "./TodoProtocol.js";
import { captureConversationTodoSnapshot } from "./TodoProtocolValidator.js";

export class InMemoryConversationTodoStore implements ConversationTodoStore {
  readonly #snapshots = new Map<string, ConversationTodoSnapshot>();

  async read(conversationId: string): Promise<ConversationTodoSnapshot | undefined> {
    const snapshot = this.#snapshots.get(conversationId);
    return snapshot === undefined
      ? undefined
      : captureConversationTodoSnapshot(snapshot);
  }

  async save(snapshot: ConversationTodoSnapshot): Promise<void> {
    const captured = captureConversationTodoSnapshot(snapshot);
    const current = this.#snapshots.get(captured.conversationId);
    if (current !== undefined && captured.revision < current.revision) {
      throw new TypeError("Todo revisions must be monotonic");
    }
    this.#snapshots.set(captured.conversationId, captured);
  }
}
