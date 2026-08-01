/** Stable errors shared by local Conversation handles and future proxies. */
export class ConversationNotFoundError extends Error {
  readonly code = "CONVERSATION_NOT_FOUND";

  constructor(public readonly conversationId: string) {
    super(`Conversation was not found: ${conversationId}`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationHandleClosingError extends Error {
  readonly code = "CONVERSATION_HANDLE_CLOSING";

  constructor(public readonly conversationId: string) {
    super(`Conversation handle is closing: ${conversationId}`);
    this.name = "ConversationHandleClosingError";
  }
}

export class ConversationHandleClosedError extends Error {
  readonly code = "CONVERSATION_HANDLE_CLOSED";

  constructor(public readonly conversationId: string) {
    super(`Conversation handle is closed: ${conversationId}`);
    this.name = "ConversationHandleClosedError";
  }
}
