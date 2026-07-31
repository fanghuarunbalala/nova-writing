import type { InputEventReference } from "../input/InputEventReference.js";
import type { JsonObject } from "../protocol/JsonValue.js";

export interface OutputEventSnapshot {
  id: string;
  conversationId: string;
  eventType: string;
  schemaVersion: number;
  timestamp: string;
  correlationId?: string;
  causationId?: string;
  runId?: string;
  turnId?: string;
  payload: JsonObject;
}

export interface InputResponseOutputEventSnapshot extends OutputEventSnapshot {
  inputEvent: InputEventReference;
}
