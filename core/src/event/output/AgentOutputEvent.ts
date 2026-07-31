import { OutputEvent } from "./OutputEvent.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import type { OutputPayload } from "./OutputPayload.js";

export abstract class AgentOutputEvent extends OutputEvent {
  protected constructor(
    public readonly eventName: string,
    protected readonly payload: OutputPayload,
    options: OutputEventOptions,
  ) {
    super(options);
  }

  getEventType(): string {
    return `agent.${this.eventName}`;
  }

  getPayload(): OutputPayload {
    return this.payload;
  }
}
