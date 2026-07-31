import { EventPayload } from "./EventPayload.js";
import type { JsonObject } from "../../protocol/JsonValue.js";

export class UserMessagePayload extends EventPayload {
  constructor(public readonly text: string) {
    super();
  }

  toObject(): JsonObject {
    return {
      text: this.text,
    };
  }
}
