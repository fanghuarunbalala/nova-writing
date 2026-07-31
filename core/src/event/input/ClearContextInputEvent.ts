import { ContextInputEvent } from "./ContextInputEvent.js";
import type { InputEventOptions } from "./InputEventOptions.js";
import { INPUT_EVENT_TYPE } from "./InputEventType.js";
import { ClearContextPayload } from "./payload/ClearContextPayload.js";

export class ClearContextInputEvent extends ContextInputEvent {
  constructor(options: InputEventOptions = {}) {
    super("clear", new ClearContextPayload(), options);
  }

  override getEventType(): string {
    return INPUT_EVENT_TYPE.clearContext;
  }
}
