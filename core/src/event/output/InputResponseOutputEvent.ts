import { OutputEvent } from "./OutputEvent.js";
import type { InputEventReference } from "../input/InputEventReference.js";
import type { OutputPayload } from "./OutputPayload.js";
import type { InputResponseOutputEventSnapshot } from "./OutputEventSnapshot.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";

export abstract class InputResponseOutputEvent extends OutputEvent {
  protected constructor(
    public readonly inputEvent: InputEventReference,
    public readonly payload: OutputPayload,
    options: OutputEventOptions,
  ) {
    super(options);
  }

  abstract getEventType(): string;

  getPayload(): OutputPayload {
    return this.payload;
  }

  override getSnapshot(): InputResponseOutputEventSnapshot {
    return {
      ...super.getSnapshot(),
      inputEvent: this.inputEvent,
    };
  }
}
