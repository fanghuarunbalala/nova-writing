/** Compile-only proof that Conversation projections expose immutable client views. */
import {
  ConversationProjectionStore,
  type ConversationProjectionSnapshot,
} from "../src/index.js";

const store = new ConversationProjectionStore({
  conversationId: "conversation-projection-typecheck",
});
const snapshot: ConversationProjectionSnapshot = store.getSnapshot();

void store.subscribe(() => undefined);

// @ts-expect-error Timeline projections are immutable.
snapshot.timeline.push();
// @ts-expect-error Conversation identity is immutable.
snapshot.conversationId = "replacement";
