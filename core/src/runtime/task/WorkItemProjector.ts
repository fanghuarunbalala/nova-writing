/** Rebuilds work-item list projections from durable agent.tasks.updated events. */
import type { OutputEventSnapshot } from "../../event/output/OutputEventSnapshot.js";
import { OUTPUT_EVENT_TYPE } from "../../event/output/OutputEventType.js";
import type { WorkItemListStore } from "./TaskProtocol.js";
import { captureWorkItemListSnapshot } from "./TaskProtocolValidator.js";

export class WorkItemProjector {
  constructor(private readonly store: WorkItemListStore) {}

  async apply(event: OutputEventSnapshot): Promise<boolean> {
    if (event.eventType !== OUTPUT_EVENT_TYPE.agentWorkItemsUpdated) {
      return false;
    }
    const payload = event.payload;
    const snapshot = captureWorkItemListSnapshot({
      listId: payload.listId,
      revision: payload.revision,
      nextTaskSequence: payload.nextTaskSequence,
      items: payload.items,
      updatedAt: payload.updatedAt,
    });
    const current = await this.store.read(snapshot.listId);
    if (current !== undefined && current.revision >= snapshot.revision) {
      return false;
    }
    await this.store.save(snapshot);
    return true;
  }
}
