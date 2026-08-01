/**
 * Records that a Host-routed durable input reached a routing outcome.
 *
 * This event does not claim that Stop cancellation or ReloadConfig application
 * has semantically completed inside a Runtime.
 */
import type { InputEventReference } from "../input/InputEventReference.js";
import { isEventType } from "../protocol/EventType.js";
import { InputResponseOutputEvent } from "./InputResponseOutputEvent.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import {
  HostInputRoutedPayload,
  type HostInputHandler,
  type HostInputRoutingOutcome,
} from "./payload/HostInputRoutedPayload.js";

export interface DurableInputEventReference extends InputEventReference {
  sequence: number;
}

export interface HostInputRoutedOutputEventOptions extends OutputEventOptions {
  inputEvent: DurableInputEventReference;
  handler: HostInputHandler;
  outcome: HostInputRoutingOutcome;
}

export class HostInputRoutedOutputEvent extends InputResponseOutputEvent {
  constructor(options: HostInputRoutedOutputEventOptions) {
    const { inputEvent, handler, outcome, ...eventOptions } = options;
    const capturedInput = captureInputReference(inputEvent);
    super(capturedInput, new HostInputRoutedPayload(handler, outcome), {
      ...eventOptions,
      causationId: eventOptions.causationId ?? capturedInput.id,
    });
  }

  getEventType(): string {
    return OUTPUT_EVENT_TYPE.hostInputRouted;
  }
}

function captureInputReference(
  inputEvent: DurableInputEventReference,
): DurableInputEventReference {
  if (
    inputEvent === null ||
    typeof inputEvent !== "object" ||
    typeof inputEvent.id !== "string" ||
    inputEvent.id.trim().length === 0 ||
    typeof inputEvent.eventType !== "string" ||
    !isEventType(inputEvent.eventType) ||
    !Number.isSafeInteger(inputEvent.sequence) ||
    inputEvent.sequence <= 0
  ) {
    throw new TypeError("Host-routed input reference must contain durable identity");
  }
  return Object.freeze({
    id: inputEvent.id,
    eventType: inputEvent.eventType,
    sequence: inputEvent.sequence,
  });
}
