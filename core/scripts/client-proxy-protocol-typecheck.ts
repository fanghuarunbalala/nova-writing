/** Compile-only proof that clients use bound Conversation and immutable wire contracts. */
import type {
  ApiRequest,
  Conversation,
  NovelApiClient,
} from "../src/index.js";

declare const api: NovelApiClient;
declare const conversation: Conversation;
declare const request: ApiRequest;

void api.conversations.open("conversation-typecheck");
void conversation.events.list({ anchor: { from: "start" } });
void conversation.events.subscribe({ start: { afterSequence: 3 } });

// @ts-expect-error Bound Conversation Event queries cannot override conversationId.
void conversation.events.list({ conversationId: "another-conversation", anchor: { from: "start" } });

// @ts-expect-error Wire request identity is immutable after creation.
request.requestId = "replacement-request";
