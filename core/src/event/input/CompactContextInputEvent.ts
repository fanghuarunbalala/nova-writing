import { ContextInputEvent } from "./ContextInputEvent.js";
import type { InputEventOptions } from "./InputEventOptions.js";
import { INPUT_EVENT_TYPE } from "./InputEventType.js";
import { CompactContextPayload } from "./payload/CompactContextPayload.js";

export class CompactContextInputEvent extends ContextInputEvent {
  constructor(options: InputEventOptions = {}) {
    super("compact", new CompactContextPayload(), options);
  }

  override getEventType(): string {
    return INPUT_EVENT_TYPE.compactContext;
  }
}
