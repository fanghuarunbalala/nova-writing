/** Payload-free InputEvent identity that has already been assigned a Journal Sequence. */
import { isEventType } from "../protocol/EventType.js";
import type { InputEventReference } from "./InputEventReference.js";

export interface DurableInputEventReference extends InputEventReference {
  sequence: number;
}

export function captureDurableInputEventReference(
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
    throw new TypeError("Durable input reference must contain valid Journal identity");
  }

  return Object.freeze({
    id: inputEvent.id,
    eventType: inputEvent.eventType,
    sequence: inputEvent.sequence,
  });
}
