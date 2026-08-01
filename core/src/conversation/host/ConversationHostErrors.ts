/** Stable Host lifecycle and Runtime boundary errors without raw failure data. */
export class ConversationHostClosingError extends Error {
  readonly code = "CONVERSATION_HOST_CLOSING";

  constructor() {
    super("Conversation host is closing");
    this.name = "ConversationHostClosingError";
  }
}

export class ConversationHostClosedError extends Error {
  readonly code = "CONVERSATION_HOST_CLOSED";

  constructor() {
    super("Conversation host is closed");
    this.name = "ConversationHostClosedError";
  }
}

export class ConversationRuntimeActivationError extends Error {
  readonly code = "CONVERSATION_RUNTIME_ACTIVATION_FAILED";

  constructor(
    public readonly conversationId: string,
    public readonly errorName: string,
    public readonly errorCode?: string,
  ) {
    super(`Conversation Runtime activation failed: ${conversationId}`);
    this.name = "ConversationRuntimeActivationError";
  }
}

export class ConversationRuntimeHandleMismatchError extends Error {
  readonly code = "CONVERSATION_RUNTIME_HANDLE_MISMATCH";

  constructor(
    public readonly expectedConversationId: string,
    public readonly receivedConversationId: string,
    public readonly expectedRuntimeInstanceId: string,
    public readonly receivedRuntimeInstanceId: string,
  ) {
    super(`Conversation Runtime handle identity does not match its bootstrap`);
    this.name = "ConversationRuntimeHandleMismatchError";
  }
}

export class ConversationRuntimeDispatchError extends Error {
  readonly code = "CONVERSATION_RUNTIME_DISPATCH_FAILED";

  constructor(
    public readonly conversationId: string,
    public readonly sequence: number,
    public readonly errorName: string,
    public readonly errorCode?: string,
  ) {
    super(`Conversation Runtime input dispatch failed: ${conversationId}/${sequence}`);
    this.name = "ConversationRuntimeDispatchError";
  }
}
