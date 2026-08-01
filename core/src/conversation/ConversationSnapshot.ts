/** Durable current Conversation state returned by the public query path. */
import type {
  ConversationAgentBinding,
  ConversationMetadata,
} from "../storage/index.js";

export interface ConversationSnapshot {
  readonly metadata: Readonly<ConversationMetadata>;
  readonly activeAgentBinding: Readonly<ConversationAgentBinding>;
}
