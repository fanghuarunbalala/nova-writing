/**
 * Records that a Host-routed durable input reached a routing outcome.
 *
 * This event does not claim that Stop cancellation or ReloadConfig application
 * has semantically completed inside a Runtime.
 */
import {
  captureDurableInputEventReference,
  type DurableInputEventReference,
} from "../input/DurableInputEventReference.js";
import { InputResponseOutputEvent } from "./InputResponseOutputEvent.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import {
  HostInputRoutedPayload,
  type HostInputHandler,
  type HostInputRoutingOutcome,
} from "./payload/HostInputRoutedPayload.js";

export interface HostInputRoutedOutputEventOptions extends OutputEventOptions {
  inputEvent: DurableInputEventReference;
  handler: HostInputHandler;
  outcome: HostInputRoutingOutcome;
}

export class HostInputRoutedOutputEvent extends InputResponseOutputEvent {
  constructor(options: HostInputRoutedOutputEventOptions) {
    const { inputEvent, handler, outcome, ...eventOptions } = options;
    const capturedInput = captureDurableInputEventReference(inputEvent);
    super(capturedInput, new HostInputRoutedPayload(handler, outcome), {
      ...eventOptions,
      causationId: eventOptions.causationId ?? capturedInput.id,
    });
  }

  getEventType(): string {
    return OUTPUT_EVENT_TYPE.hostInputRouted;
  }
}
