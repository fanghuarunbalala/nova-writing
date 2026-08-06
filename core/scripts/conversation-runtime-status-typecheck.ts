/** Compile-only proof for the desktop Runtime status classifier. */
import {
  CONVERSATION_RUNTIME_STATUS,
  classifyConversationRuntimeStatus,
  type ConversationRuntimeStatus,
} from "../src/runtime/index.js";

declare const status: ConversationRuntimeStatus;
void status;
void CONVERSATION_RUNTIME_STATUS;
void classifyConversationRuntimeStatus({
  presence: { state: "online", observedAt: "" },
});
