/** Bounded durable Input inbox with lane-specific deterministic ordering. */
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import { RuntimeInputQueueFullError } from "./RuntimeInputErrors.js";
import type { RuntimeInputLane } from "./RuntimeInputLanePolicy.js";

export class RuntimeInputInbox {
  private readonly events = new Map<number, PersistedInputEventSnapshot>();

  constructor(
    readonly lane: RuntimeInputLane,
    readonly capacity: number,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError("Runtime input inbox capacity must be positive");
    }
  }

  get size(): number {
    return this.events.size;
  }

  has(sequence: number): boolean {
    return this.events.has(sequence);
  }

  get(sequence: number): PersistedInputEventSnapshot | undefined {
    return this.events.get(sequence);
  }

  enqueue(event: PersistedInputEventSnapshot): void {
    if (this.events.has(event.sequence)) return;
    if (this.events.size >= this.capacity) {
      throw new RuntimeInputQueueFullError(this.lane, this.capacity);
    }
    this.events.set(event.sequence, event);
  }

  peek(): PersistedInputEventSnapshot | undefined {
    return this.select(false);
  }

  dequeue(): PersistedInputEventSnapshot | undefined {
    return this.select(true);
  }

  removeThrough(sequence: number): readonly PersistedInputEventSnapshot[] {
    const removed = [...this.events.values()]
      .filter((event) => event.sequence <= sequence)
      .sort((left, right) => left.sequence - right.sequence);
    for (const event of removed) this.events.delete(event.sequence);
    return Object.freeze(removed);
  }

  private select(remove: boolean): PersistedInputEventSnapshot | undefined {
    let selected: PersistedInputEventSnapshot | undefined;
    for (const event of this.events.values()) {
      if (selected === undefined || this.precedes(event, selected)) selected = event;
    }
    if (remove && selected !== undefined) this.events.delete(selected.sequence);
    return selected;
  }

  private precedes(
    candidate: PersistedInputEventSnapshot,
    selected: PersistedInputEventSnapshot,
  ): boolean {
    if (this.lane === "turn") return candidate.sequence < selected.sequence;
    return (
      candidate.priority > selected.priority ||
      (candidate.priority === selected.priority && candidate.sequence < selected.sequence)
    );
  }
}
