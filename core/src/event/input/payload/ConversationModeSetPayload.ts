/**
 * Conversation mode-set payload: carries the target per-conversation mode.
 * Validation is inline (not via runtime/compose) to keep the event layer
 * free of runtime dependencies.
 */
import type { ConversationMode } from "../../../runtime/compose/index.js";
import type { JsonObject } from "../../protocol/JsonValue.js";
import { EventPayload } from "./EventPayload.js";

export interface ConversationModeSetPayloadOptions {
  readonly mode: ConversationMode;
}

export class ConversationModeSetPayload extends EventPayload {
  readonly mode: ConversationMode;

  constructor(options: ConversationModeSetPayloadOptions) {
    super();
    this.mode = requireMode(options.mode);
  }

  toObject(): JsonObject {
    return { mode: this.mode };
  }
}

function requireMode(value: unknown): ConversationMode {
  if (value !== "review" && value !== "bypass" && value !== "compose") {
    throw new TypeError("Conversation mode is invalid");
  }
  return value;
}
