import type { JsonObject } from "../protocol/JsonValue.js";

export interface InputEventSnapshot {
  id: string;
  conversationId: string;
  eventType: string;
  schemaVersion: number;
  priority: number;
  timestamp: string;
  correlationId?: string;
  causationId?: string;
  runId?: string;
  turnId?: string;
  payload: JsonObject;
}
