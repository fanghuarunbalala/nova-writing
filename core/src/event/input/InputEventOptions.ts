import type { EventCreationOptions } from "../protocol/EventMetadata.js";

export interface InputEventOptions extends EventCreationOptions {
  conversationId?: string;
}
