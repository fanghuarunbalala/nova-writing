/**
 * Serializes asynchronous operations per Conversation while allowing different
 * Conversations to continue concurrently.
 *
 * A rejected operation never poisons the next operation for the same
 * Conversation. `drain()` waits until every operation accepted before and
 * during the drain has settled.
 */
export class ConversationOperationSerializer {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(conversationId: string, operation: () => Promise<T>): Promise<T> {
    const previousTail = this.tails.get(conversationId) ?? Promise.resolve();
    const result = previousTail.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );

    this.tails.set(conversationId, tail);
    void tail.finally(() => {
      if (this.tails.get(conversationId) === tail) {
        this.tails.delete(conversationId);
      }
    });

    return result;
  }

  async drain(): Promise<void> {
    while (this.tails.size > 0) {
      await Promise.all([...this.tails.values()]);
    }
  }
}
