/** Compile-only proof for Conversation-scoped Composer drafts and references. */
import {
  ComposerDraftStore,
  ConversationComposer,
  type ComposerContentReference,
  type ComposerDraftSnapshot,
} from "../src/index.js";

declare const reference: ComposerContentReference;
const store = new ComposerDraftStore([
  { conversationId: "conversation-1", references: [reference] },
]);
const snapshot: ComposerDraftSnapshot = store.getSnapshot("conversation-1");
const composer = (
  <ConversationComposer
    conversationId="conversation-1"
    draftStore={store}
    enabled
    enqueue={async () => ({
      status: "accepted",
      conversationId: "conversation-1",
      inputEventId: "input-1",
      sequence: 1,
      acceptedAt: "2026-08-03T00:00:00.000Z",
    })}
    onOpenReference={(selected) => void selected.target}
  />
);

void snapshot;
void composer;
