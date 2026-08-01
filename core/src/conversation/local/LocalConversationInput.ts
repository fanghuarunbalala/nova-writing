/** Conversation-bound command adapter; concrete command execution is injected. */
import type { InputEvent, InputReceipt } from "../../event/index.js";
import type { ConversationCommandService } from "../ConversationCommandService.js";
import type { ConversationInput } from "../ConversationInput.js";

export interface LocalConversationInputOptions {
  conversationId: string;
  commandService: ConversationCommandService;
  assertHandleOpen: () => void;
}

export class LocalConversationInput implements ConversationInput {
  private readonly conversationId: string;
  private readonly commandService: ConversationCommandService;
  private readonly assertHandleOpen: () => void;

  constructor(options: LocalConversationInputOptions) {
    this.conversationId = options.conversationId;
    this.commandService = options.commandService;
    this.assertHandleOpen = options.assertHandleOpen;
  }

  enqueue(event: InputEvent): Promise<InputReceipt> {
    this.assertHandleOpen();
    return this.commandService.enqueue(this.conversationId, event);
  }
}
