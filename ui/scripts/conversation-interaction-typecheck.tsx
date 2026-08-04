/** Compile-only proof for the Conversation interaction layer. */
import {
  createConversationInteractionCommands,
  useConversationInteraction,
  type ConversationInteractionCommands,
} from "../src/index.js";
import type { ConversationProjectionHookResult } from "../src/index.js";

declare const result: ConversationProjectionHookResult;
declare const commands: ConversationInteractionCommands;

void useConversationInteraction(result);
void commands.send("hello");
void createConversationInteractionCommands({
  conversationId: "conversation",
  enqueue: async () =>
    ({ status: "accepted", sequence: 1 }) as Awaited<ReturnType<typeof commands.send>>,
});
