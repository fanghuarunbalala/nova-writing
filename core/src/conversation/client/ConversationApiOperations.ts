/** Initial logical Conversation operations carried by every frontend Transport. */
import type {
  BoundConversationEventSubscriptionOptions,
  ConversationEventListOptions,
} from "../ConversationEvents.js";
import type { InputEventSnapshot } from "../../event/index.js";

export const CONVERSATION_API_OPERATION = {
  inputEnqueue: "conversation.input.enqueue",
  eventsList: "conversation.events.list",
  eventsSubscribe: "conversation.events.subscribe",
  snapshotGet: "conversation.snapshot.get",
  runtimePresenceGet: "conversation.runtimePresence.get",
} as const;

export type ConversationApiOperation =
  (typeof CONVERSATION_API_OPERATION)[keyof typeof CONVERSATION_API_OPERATION];

export interface ConversationIdentityRequest {
  readonly conversationId: string;
}

export interface EnqueueConversationInputRequest
  extends ConversationIdentityRequest {
  readonly inputEvent: InputEventSnapshot;
}

export interface ListConversationEventsRequest
  extends ConversationIdentityRequest {
  readonly options: ConversationEventListOptions;
}

export type SerializableConversationEventSubscriptionOptions = Omit<
  BoundConversationEventSubscriptionOptions,
  "signal"
>;

export interface SubscribeConversationEventsRequest
  extends ConversationIdentityRequest {
  readonly options: SerializableConversationEventSubscriptionOptions;
}
