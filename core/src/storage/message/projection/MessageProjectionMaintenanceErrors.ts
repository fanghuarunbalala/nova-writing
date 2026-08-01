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

export class MessageProjectionJournalWatermarkError extends MessageProjectionMaintenanceError {
  constructor(
    public readonly conversationId: string,
    public readonly expectedHighWatermark: number,
    public readonly actualHighWatermark: number,
  ) {
    super(
      `Journal High Watermark changed for Conversation ${conversationId}: expected ${expectedHighWatermark}, received ${actualHighWatermark}`,
    );
    this.name = "MessageProjectionJournalWatermarkError";
  }
}

export class MessageProjectionInspectionUnstableError extends MessageProjectionMaintenanceError {
  constructor(public readonly conversationId: string) {
    super(`Message projection changed repeatedly during inspection: ${conversationId}`);
    this.name = "MessageProjectionInspectionUnstableError";
  }
}

export class MessageProjectionEventProjectionError extends MessageProjectionMaintenanceError {
  constructor(
    public readonly conversationId: string,
    public readonly eventId: string,
    public readonly sequence: number,
    public readonly projectorId: string,
    public readonly projectorVersion: string,
    options?: ErrorOptions,
  ) {
    super(
      `Runtime Message projection failed for Event ${eventId} at Sequence ${sequence}`,
      options,
    );
    this.name = "MessageProjectionEventProjectionError";
  }
}
