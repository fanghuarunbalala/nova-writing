import type { EventCreationOptions } from "../protocol/EventMetadata.js";

export interface OutputEventOptions extends EventCreationOptions {
  conversationId: string;
}
