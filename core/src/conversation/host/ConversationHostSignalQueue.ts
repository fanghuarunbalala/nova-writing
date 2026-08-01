/** Bounded priority queue for payload-free accepted-input Host signals. */
import type { AcceptedConversationInputSignal } from "../command/index.js";

export class ConversationHostSignalQueue {
  private readonly signals = new Map<number, AcceptedConversationInputSignal>();

  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError("Conversation Host signal queue capacity must be positive");
    }
  }

  get size(): number {
    return this.signals.size;
  }

  has(sequence: number): boolean {
    return this.signals.has(sequence);
  }

  enqueue(signal: AcceptedConversationInputSignal): boolean {
    if (this.signals.has(signal.sequence)) return false;
    if (this.signals.size >= this.capacity) return false;
    this.signals.set(signal.sequence, signal);
    return true;
  }

  delete(sequence: number): boolean {
    return this.signals.delete(sequence);
  }

  peek(): AcceptedConversationInputSignal | undefined {
    let selected: AcceptedConversationInputSignal | undefined;
    for (const signal of this.signals.values()) {
      if (
        selected === undefined ||
        signal.priority > selected.priority ||
        (signal.priority === selected.priority && signal.sequence < selected.sequence)
      ) {
        selected = signal;
      }
    }
    return selected;
  }

  clear(): void {
    this.signals.clear();
  }
}
