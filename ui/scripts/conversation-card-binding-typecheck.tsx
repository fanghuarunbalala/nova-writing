/** Compile-only proof for one-stream Card projection through Conversation Binding. */
import type { NovelApiClient } from "@novel/core";
import {
  ConversationCardProjectorRegistry,
  ConversationProjectionBinding,
} from "../src/index.js";

declare const api: NovelApiClient;
const cardProjectors = new ConversationCardProjectorRegistry();
const binding = new ConversationProjectionBinding({
  api,
  conversationId: "conversation-card-binding",
  cardProjectors,
});
const snapshot = binding.getSnapshot();

// @ts-expect-error Card projection snapshots are immutable.
snapshot.cards.cards = [];

void binding;
