/** Serializes asynchronous operations by key while allowing unrelated keys to run concurrently. */
export class KeyedAsyncMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async withExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolveCurrent) => {
      releaseCurrent = resolveCurrent;
    });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);

    await previous;
    try {
      return await operation();
    } finally {
      releaseCurrent();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
