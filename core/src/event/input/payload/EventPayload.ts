import type { JsonObject } from "../../protocol/JsonValue.js";

export abstract class EventPayload {
  abstract toObject(): JsonObject;
}
