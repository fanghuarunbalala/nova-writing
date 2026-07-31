import { SystemInputEvent } from "./SystemInputEvent.js";
import type { InputEventOptions } from "./InputEventOptions.js";
import { INPUT_EVENT_TYPE } from "./InputEventType.js";
import { StopPayload } from "./payload/StopPayload.js";

export class StopInputEvent extends SystemInputEvent {
  constructor(options: InputEventOptions = {}) {
    super("stop", new StopPayload(), options);
  }

  override getEventType(): string {
    return INPUT_EVENT_TYPE.systemStop;
  }
}
