import { EventPayload } from "./EventPayload.js";
import type { JsonObject } from "../../protocol/JsonValue.js";

export class StopPayload extends EventPayload {
  toObject(): JsonObject {
    return {};
  }
}
