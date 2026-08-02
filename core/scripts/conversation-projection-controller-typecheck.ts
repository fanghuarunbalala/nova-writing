/** Compile-only proof that the Projection Controller exposes immutable client state. */
import {
  ConversationProjectionController,
  ConversationProjectionStore,
  type Conversation,
  type ConversationProjectionControllerSnapshot,
} from "../src/index.js";

declare const conversation: Conversation;

const store = new ConversationProjectionStore({
  conversationId: conversation.id,
});
const controller = new ConversationProjectionController({
  conversation,
  store,
});
const snapshot: ConversationProjectionControllerSnapshot =
  controller.getSnapshot();

void controller.subscribe(() => undefined);

// @ts-expect-error Controller state snapshots are immutable.
snapshot.state = "stopped";
// @ts-expect-error Conversation identity is immutable.
snapshot.conversationId = "replacement";
