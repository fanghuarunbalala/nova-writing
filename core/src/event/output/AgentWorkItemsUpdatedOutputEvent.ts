/** Agent OutputEvent carrying the durable current work-item list snapshot for one list. */
import { AgentOutputEvent } from "./AgentOutputEvent.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import {
  AgentWorkItemsUpdatedPayload,
  type AgentWorkItemsUpdatedPayloadOptions,
} from "./payload/AgentWorkItemsUpdatedPayload.js";

type AgentWorkItemsUpdatedEventOptions = Omit<OutputEventOptions, "runId"> &
  AgentWorkItemsUpdatedPayloadOptions & {
    readonly runId: string;
    readonly turnId?: string;
  };

export class AgentWorkItemsUpdatedOutputEvent extends AgentOutputEvent {
  constructor(options: AgentWorkItemsUpdatedEventOptions) {
    const { runId, turnId, ...eventOptions } = options;
    super(
      "tasks.updated",
      new AgentWorkItemsUpdatedPayload(options),
      {
        ...eventOptions,
        runId,
        ...(turnId === undefined ? {} : { turnId }),
      },
    );
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.agentWorkItemsUpdated;
  }
}
