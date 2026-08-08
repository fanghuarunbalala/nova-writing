/** Read-only boundary for a Conversation's active compose session sub-state. */
import type { ConversationComposeState } from "../storage/index.js";

export interface ConversationComposeStateReader {
  /** 读取活跃 compose 会话子状态；无会话时返回 undefined。 */
  /** Returns the active compose session sub-state, or undefined when idle. */
  getConversationComposeState(
    conversationId: string,
  ): Promise<ConversationComposeState | undefined>;
}
