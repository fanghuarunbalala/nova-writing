export class MessageProjectionMaintenanceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MessageProjectionMaintenanceError";
  }
}

export class MessageProjectionSchemaUnavailableError extends MessageProjectionMaintenanceError {
  constructor(public readonly conversationId: string, options?: ErrorOptions) {
    super(`Runtime Message schema is unavailable for Conversation: ${conversationId}`, options);
    this.name = "MessageProjectionSchemaUnavailableError";
  }
}

export class MessageProjectionJournalGapError extends MessageProjectionMaintenanceError {
  constructor(
    public readonly conversationId: string,
    public readonly expectedSequence: number,
    public readonly actualSequence: number,
  ) {
    super(
      `Journal sequence gap for Conversation ${conversationId}: expected ${expectedSequence}, received ${actualSequence}`,
    );
    this.name = "MessageProjectionJournalGapError";
  }
}

export class MessageProjectionMaintenanceAbortedError extends MessageProjectionMaintenanceError {
  constructor(public readonly conversationId: string, options?: ErrorOptions) {
    super(`Message projection maintenance was aborted: ${conversationId}`, options);
    this.name = "MessageProjectionMaintenanceAbortedError";
  }
}

export class MessageProjectionInvariantError extends MessageProjectionMaintenanceError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MessageProjectionInvariantError";
  }
}
