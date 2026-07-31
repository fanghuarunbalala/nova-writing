import { InputEvent } from "./InputEvent.js";
import { EventPayload } from "./payload/EventPayload.js";
import type { InputEventOptions } from "./InputEventOptions.js";
import { INPUT_PRIORITY } from "./InputPriority.js";

export abstract class UserInputEvent extends InputEvent {
  protected constructor(
    public readonly eventName: string,
    protected readonly payload: EventPayload,
    options: InputEventOptions = {},
  ) {
    super(options);
  }

  getEventType(): string {
    return `user.${this.eventName}`;
  }

  getPriority(): number {
    return INPUT_PRIORITY.user;
  }

  getPayload(): EventPayload {
    return this.payload;
  }
}
