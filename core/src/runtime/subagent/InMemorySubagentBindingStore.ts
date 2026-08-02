/** Serialized in-memory Binding Store with bounded catch-up and live changes. */
import { captureSubagentBinding, isSubagentTerminalStatus } from "./SubagentProtocolValidator.js";
import type { SubagentBinding } from "./SubagentProtocol.js";
import type { SubagentBindingChange, SubagentBindingQuery, SubagentBindingStore, SubagentBindingSubscription } from "./SubagentBindingStore.js";

export class InMemorySubagentBindingStore implements SubagentBindingStore {
  readonly #bindings = new Map<string, SubagentBinding>();
  readonly #changes: SubagentBindingChange[] = [];
  readonly #subscriptions = new Set<MemoryBindingSubscription>();
  #tail: Promise<void> = Promise.resolve();

  put(bindingSource: SubagentBinding): Promise<void> {
    const binding = captureSubagentBinding(bindingSource);
    return this.#serialize(async () => {
      this.#bindings.set(binding.subagentId, binding);
      const change = Object.freeze({ sequence: this.#changes.length + 1, binding });
      this.#changes.push(change);
      for (const subscription of this.#subscriptions) subscription.push(change);
    });
  }

  async get(subagentId: string): Promise<SubagentBinding | undefined> { return this.#bindings.get(subagentId); }

  async list(query: SubagentBindingQuery = {}): Promise<readonly SubagentBinding[]> {
    return Object.freeze([...this.#bindings.values()].filter((binding) =>
      (query.parentConversationId === undefined || binding.parentConversationId === query.parentConversationId) &&
      (query.parentRunId === undefined || binding.parentRunId === query.parentRunId) &&
      (query.activeOnly !== true || !isSubagentTerminalStatus(binding.status)),
    ));
  }

  subscribe(afterSequence = 0): SubagentBindingSubscription {
    const subscription = new MemoryBindingSubscription(
      this.#changes.filter((change) => change.sequence > afterSequence),
      () => this.#subscriptions.delete(subscription),
    );
    this.#subscriptions.add(subscription);
    return subscription;
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> { const result = this.#tail.then(operation, operation); this.#tail = result.then(() => undefined, () => undefined); return result; }
}

class MemoryBindingSubscription implements SubagentBindingSubscription, AsyncIterator<SubagentBindingChange> {
  readonly #queue: SubagentBindingChange[];
  readonly #waiters: Array<(result: IteratorResult<SubagentBindingChange>) => void> = [];
  #closed = false;
  constructor(initial: readonly SubagentBindingChange[], private readonly onClose: () => void) { this.#queue = [...initial]; }
  [Symbol.asyncIterator](): AsyncIterator<SubagentBindingChange> { return this; }
  next(): Promise<IteratorResult<SubagentBindingChange>> { if (this.#queue.length > 0) return Promise.resolve({ done: false, value: this.#queue.shift()! }); if (this.#closed) return Promise.resolve({ done: true, value: undefined }); return new Promise((resolve) => this.#waiters.push(resolve)); }
  push(change: SubagentBindingChange): void { if (this.#closed) return; const waiter = this.#waiters.shift(); if (waiter) waiter({ done: false, value: change }); else this.#queue.push(change); }
  async close(): Promise<void> { if (this.#closed) return; this.#closed = true; this.onClose(); for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined }); }
}
