/** Command boundary used by a bound Conversation handle. */
import type { InputEvent, InputReceipt } from "../event/index.js";

export interface ConversationCommandService {
  enqueue(conversationId: string, event: InputEvent): Promise<InputReceipt>;
}
