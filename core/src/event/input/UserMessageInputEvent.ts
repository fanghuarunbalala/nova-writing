import { UserInputEvent } from "./UserInputEvent.js";
import type { InputEventOptions } from "./InputEventOptions.js";
import { INPUT_EVENT_TYPE } from "./InputEventType.js";
import { UserMessagePayload } from "./payload/UserMessagePayload.js";

export interface UserMessageInputEventOptions extends InputEventOptions {
  text: string;
}

export class UserMessageInputEvent extends UserInputEvent {
  constructor(options: UserMessageInputEventOptions) {
    super("message", new UserMessagePayload(options.text), options);
  }

  override getEventType(): string {
    return INPUT_EVENT_TYPE.userMessage;
  }
}
