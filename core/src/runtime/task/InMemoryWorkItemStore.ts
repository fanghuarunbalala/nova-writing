/** Process-local work-item list projection used by tests and lightweight Runtime hosts. */
import type {
  WorkItemListSnapshot,
  WorkItemListStore,
} from "./TaskProtocol.js";
import { captureWorkItemListSnapshot } from "./TaskProtocolValidator.js";

export class InMemoryWorkItemStore implements WorkItemListStore {
  readonly #snapshots = new Map<string, WorkItemListSnapshot>();

  async read(listId: string): Promise<WorkItemListSnapshot | undefined> {
    const snapshot = this.#snapshots.get(listId);
    return snapshot === undefined
      ? undefined
      : captureWorkItemListSnapshot(snapshot);
  }

  async save(snapshot: WorkItemListSnapshot): Promise<void> {
    const captured = captureWorkItemListSnapshot(snapshot);
    const current = this.#snapshots.get(captured.listId);
    if (current !== undefined && captured.revision < current.revision) {
      throw new TypeError("Work item list revisions must be monotonic");
    }
    this.#snapshots.set(captured.listId, captured);
  }
}
