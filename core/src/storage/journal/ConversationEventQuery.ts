import type { EventKind } from "../../event/index.js";
import type { PersistedConversationEventSnapshot } from "./PersistedConversationEventSnapshot.js";

export type ConversationEventQueryAnchor =
  | { from: "start" }
  | { from: "end" }
  | { afterSequence: number }
  | { beforeSequence: number };

export interface ConversationEventQuery {
  conversationId: string;
  anchor: ConversationEventQueryAnchor;
  throughSequence?: number;
  direction?: EventKind;
  eventTypes?: string[];
  runId?: string;
  turnId?: string;
  limit?: number;
}

export interface ConversationEventPage {
  events: PersistedConversationEventSnapshot[];
  highWatermark: number;
  hasPrevious: boolean;
  hasNext: boolean;
}
