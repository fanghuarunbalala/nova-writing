import { EventPayload } from "./EventPayload.js";
import type { JsonObject } from "../../protocol/JsonValue.js";

export class EmptyPayload extends EventPayload {
  toObject(): JsonObject {
    return {};
  }
}
