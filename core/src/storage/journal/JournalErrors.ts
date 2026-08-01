import type { EventKind } from "../../event/index.js";

export class JournalConversationNotFoundError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Conversation does not exist: ${conversationId}`);
    this.name = "JournalConversationNotFoundError";
  }
}

export class JournalConversationNotAcceptingInputError extends Error {
  constructor(
    public readonly conversationId: string,
    public readonly status: "archived" | "disposed",
  ) {
    super(`Conversation is not accepting input: ${conversationId}`);
    this.name = "JournalConversationNotAcceptingInputError";
  }
}

export class JournalEventConflictError extends Error {
  constructor(
    public readonly conversationId: string,
    public readonly eventId: string,
    public readonly existingDirection: EventKind,
    public readonly requestedDirection: EventKind,
  ) {
    super(`Journal event conflicts with an existing event: ${conversationId}/${eventId}`);
    this.name = "JournalEventConflictError";
  }
}

export class JournalRecordCorruptedError extends Error {
  constructor(
    message: string,
    public readonly conversationId: string,
    public readonly sequence: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JournalRecordCorruptedError";
  }
}

export class ConversationEventQueryError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ConversationEventQueryError";
  }
}
