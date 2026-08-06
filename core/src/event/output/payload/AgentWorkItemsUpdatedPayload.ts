/** Durable complete work-item list snapshot emitted after a Runtime Task mutation. */
import type { WorkItemListSnapshot } from "../../../runtime/task/TaskProtocol.js";
import { captureWorkItemListSnapshot } from "../../../runtime/task/TaskProtocolValidator.js";
import type { JsonObject } from "../../protocol/JsonValue.js";
import { OutputPayload } from "../OutputPayload.js";

export interface AgentWorkItemsUpdatedPayloadOptions {
  readonly toolCallId: string;
  readonly listId: string;
  readonly revision: number;
  readonly nextTaskSequence: number;
  readonly items: WorkItemListSnapshot["items"];
  readonly updatedAt: string;
}

export class AgentWorkItemsUpdatedPayload extends OutputPayload {
  readonly toolCallId: string;
  readonly listId: string;
  readonly revision: number;
  readonly nextTaskSequence: number;
  readonly items: WorkItemListSnapshot["items"];
  readonly updatedAt: string;

  constructor(options: AgentWorkItemsUpdatedPayloadOptions) {
    super();
    this.toolCallId = requireNonBlank("Task Tool Call ID", options.toolCallId);
    this.listId = requireNonBlank("Task list ID", options.listId);
    this.revision = requirePositiveInteger("Task revision", options.revision);
    this.nextTaskSequence = requirePositiveInteger(
      "Task sequence",
      options.nextTaskSequence,
    );
    this.items = captureWorkItemListSnapshot({
      listId: options.listId,
      revision: options.revision,
      nextTaskSequence: options.nextTaskSequence,
      items: options.items,
      updatedAt: options.updatedAt,
    }).items;
    this.updatedAt = requireNonBlank("Task update time", options.updatedAt);
  }

  toObject(): JsonObject {
    return {
      toolCallId: this.toolCallId,
      listId: this.listId,
      revision: this.revision,
      nextTaskSequence: this.nextTaskSequence,
      items: this.items.map((item) => ({
        id: item.id,
        subject: item.subject,
        description: item.description,
        status: item.status,
        ...(item.activeForm === undefined ? {} : { activeForm: item.activeForm }),
        ...(item.owner === undefined ? {} : { owner: item.owner }),
        blocks: [...item.blocks],
        blockedBy: [...item.blockedBy],
        metadata: item.metadata as unknown as JsonObject,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      updatedAt: this.updatedAt,
    };
  }
}

function requireNonBlank(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requirePositiveInteger(label: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as number;
}
