/** Read-only logical Runtime presence boundary without placement details. */
import type { RuntimePresence } from "./RuntimePresence.js";

export interface ConversationRuntimePresenceReader {
  getRuntimePresence(conversationId: string): Promise<RuntimePresence>;
}
