/** Logical Conversation operations carried by every frontend Transport. */
import type {
  BoundConversationEventSubscriptionOptions,
  ConversationEventListOptions,
} from "../ConversationEvents.js";
import type {
  CreateConversationOptions,
  ListConversationsOptions,
} from "../catalog/index.js";
import type { InputEventSnapshot } from "../../event/index.js";

export const CONVERSATION_API_OPERATION = {
  create: "conversation.create",
  list: "conversation.list",
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

export interface CreateConversationRequest {
  readonly options: CreateConversationOptions;
}

export interface ListConversationsRequest {
  readonly options: ListConversationsOptions;
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
