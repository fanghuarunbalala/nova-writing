import { OutputPayload } from "../OutputPayload.js";
import type { JsonObject } from "../../protocol/JsonValue.js";

export class EmptyOutputPayload extends OutputPayload {
  toObject(): JsonObject {
    return {};
  }
}
