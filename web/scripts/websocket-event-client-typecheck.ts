/** Compile-only proof for the browser WebSocket Event subscription boundary. */
import type { ApiSubscription } from "@novel/core";
import {
  WebSocketEventClient,
  type BrowserWebSocketFactory,
} from "../src/index.js";

declare const createSocket: BrowserWebSocketFactory;
const client = new WebSocketEventClient({
  origin: "https://novel.example",
  createSocket,
});
const subscription: ApiSubscription = client.subscribe({
  protocolVersion: 1,
  requestId: "subscription-typecheck",
  operation: "conversation.events.subscribe",
  payload: { conversationId: "conversation-1" },
});

void subscription.next();
void client.close();
