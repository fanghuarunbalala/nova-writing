/** Confirms one terminal Runtime processing outcome for a durable InputEvent. */
import {
  captureDurableInputEventReference,
  type DurableInputEventReference,
} from "../input/DurableInputEventReference.js";
import { InputResponseOutputEvent } from "./InputResponseOutputEvent.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import {
  RuntimeInputProcessedPayload,
  type RuntimeInputProcessedPayloadOptions,
} from "./payload/RuntimeInputProcessedPayload.js";

export type RuntimeInputProcessedOutputEventOptions = OutputEventOptions &
  RuntimeInputProcessedPayloadOptions & {
    inputEvent: DurableInputEventReference;
  };

export class RuntimeInputProcessedOutputEvent extends InputResponseOutputEvent {
  constructor(options: RuntimeInputProcessedOutputEventOptions) {
    const capturedInput = captureDurableInputEventReference(options.inputEvent);
    super(capturedInput, new RuntimeInputProcessedPayload(options), {
      conversationId: options.conversationId,
      ...(options.id !== undefined ? { id: options.id } : {}),
      ...(options.timestamp !== undefined ? { timestamp: options.timestamp } : {}),
      ...(options.correlationId !== undefined
        ? { correlationId: options.correlationId }
        : {}),
      causationId: options.causationId ?? capturedInput.id,
      ...(options.runId !== undefined ? { runId: options.runId } : {}),
      ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
    });
  }

  getEventType(): string {
    return OUTPUT_EVENT_TYPE.runtimeInputProcessed;
  }
}
