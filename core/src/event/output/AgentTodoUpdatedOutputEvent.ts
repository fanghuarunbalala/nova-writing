/** Agent OutputEvent carrying the durable current Todo list for one Conversation. */
import { AgentOutputEvent } from "./AgentOutputEvent.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import {
  AgentTodoUpdatedPayload,
  type AgentTodoUpdatedPayloadOptions,
} from "./payload/AgentTodoUpdatedPayload.js";

type AgentTodoUpdatedEventOptions = Omit<OutputEventOptions, "runId"> &
  AgentTodoUpdatedPayloadOptions & {
    readonly runId: string;
    readonly turnId?: string;
  };

export class AgentTodoUpdatedOutputEvent extends AgentOutputEvent {
  constructor(options: AgentTodoUpdatedEventOptions) {
    const { runId, turnId, ...eventOptions } = options;
    super(
      "todo.updated",
      new AgentTodoUpdatedPayload(options),
      {
        ...eventOptions,
        runId,
        ...(turnId === undefined ? {} : { turnId }),
      },
    );
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.agentTodoUpdated;
  }
}
