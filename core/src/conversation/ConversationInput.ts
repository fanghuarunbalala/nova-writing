/**
 * Input API bound to one Conversation.
 *
 * The returned receipt confirms durable Journal acceptance, not Runtime or
 * Agent completion.
 */
import type { InputEvent, InputReceipt } from "../event/index.js";

export interface ConversationInput {
  enqueue(event: InputEvent): Promise<InputReceipt>;
}
