/** Event-stream frame carrying one durable Conversation Event snapshot. */
import type { PersistedConversationEventSnapshot } from "../storage/index.js";
import type { API_PROTOCOL_VERSION } from "./ApiRequest.js";

export interface ApiEventFrame {
  readonly protocolVersion: typeof API_PROTOCOL_VERSION;
  readonly subscriptionId: string;
  readonly event: PersistedConversationEventSnapshot;
}
