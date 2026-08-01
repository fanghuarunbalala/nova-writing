/**
 * Serializes Host operations per Conversation while preserving cross-
 * Conversation concurrency and recovery after rejected operations.
 */
export class ConversationHostOperationSerializer {
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
