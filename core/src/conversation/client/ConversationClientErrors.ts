/** Conversation-specific protocol failures detected before data reaches a Proxy. */
import { ApiProtocolError } from "../../transport/index.js";

export class ConversationClientProtocolError extends ApiProtocolError {
  constructor(message: string) {
    super(message);
    this.name = "ConversationClientProtocolError";
  }
}
