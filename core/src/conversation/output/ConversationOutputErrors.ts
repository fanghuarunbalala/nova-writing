/** Stable Output publication errors without Event payloads or raw failure data. */
export type ConversationOutputRejectionReason =
  | "invalid_event"
  | "unknown_event_type";

export class ConversationOutputRejectedError extends Error {
  readonly code = "CONVERSATION_OUTPUT_REJECTED";

  constructor(
    public readonly conversationId: string,
    public readonly outputEventId: string,
    public readonly eventType: string,
    public readonly reason: ConversationOutputRejectionReason,
  ) {
    super(`Conversation OutputEvent was rejected: ${reason}`);
    this.name = "ConversationOutputRejectedError";
  }
}

export class ConversationOutputConflictError extends Error {
  readonly code = "CONVERSATION_OUTPUT_CONFLICT";

  constructor(
    public readonly conversationId: string,
    public readonly outputEventId: string,
    public readonly eventType: string,
  ) {
    super("Conversation OutputEvent conflicts with a durable Event");
    this.name = "ConversationOutputConflictError";
  }
}

export class ConversationOutputPersistenceError extends Error {
  readonly code = "CONVERSATION_OUTPUT_PERSISTENCE_FAILED";

  constructor(
    public readonly conversationId: string,
    public readonly outputEventId: string,
    public readonly eventType: string,
    public readonly errorName: string,
    public readonly errorCode?: string,
  ) {
    super("Conversation OutputEvent persistence failed");
    this.name = "ConversationOutputPersistenceError";
  }
}
