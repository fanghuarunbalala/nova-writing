import type { JsonObject } from "../protocol/JsonValue.js";

export abstract class OutputPayload {
  abstract toObject(): JsonObject;
}
