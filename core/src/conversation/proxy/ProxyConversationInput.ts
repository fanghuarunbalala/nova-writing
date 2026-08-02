/** Conversation-bound Input adapter backed by a serializing ConversationClient. */
import type { InputEvent, InputReceipt } from "../../event/index.js";
import type { ConversationClient } from "../client/index.js";
import type { ConversationInput } from "../ConversationInput.js";

export interface ProxyConversationInputOptions {
  readonly conversationId: string;
  readonly client: ConversationClient;
  readonly assertHandleOpen: () => void;
}

export class ProxyConversationInput implements ConversationInput {
  private readonly conversationId: string;
  private readonly client: ConversationClient;
  private readonly assertHandleOpen: () => void;

  constructor(options: ProxyConversationInputOptions) {
    this.conversationId = options.conversationId;
    this.client = options.client;
    this.assertHandleOpen = options.assertHandleOpen;
  }

  enqueue(event: InputEvent): Promise<InputReceipt> {
    this.assertHandleOpen();
    return this.client.enqueueInput(this.conversationId, event);
  }
}
