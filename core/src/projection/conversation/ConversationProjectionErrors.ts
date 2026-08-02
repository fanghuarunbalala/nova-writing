/** Stable failures for invalid replay order or inconsistent projected Event identity. */
export class ConversationProjectionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConversationProjectionError";
  }
}

export class ConversationProjectionConversationMismatchError extends ConversationProjectionError {
  constructor(
    public readonly expectedConversationId: string,
    public readonly actualConversationId: string,
  ) {
    super(
      "CONVERSATION_PROJECTION_CONVERSATION_MISMATCH",
      "Conversation Event targets another projection",
    );
    this.name = "ConversationProjectionConversationMismatchError";
  }
}

export class ConversationProjectionSequenceGapError extends ConversationProjectionError {
  constructor(
    public readonly expectedSequence: number,
    public readonly actualSequence: number,
  ) {
    super(
      "CONVERSATION_PROJECTION_SEQUENCE_GAP",
      "Conversation Event sequence contains a gap",
    );
    this.name = "ConversationProjectionSequenceGapError";
  }
}

export class ConversationProjectionSequenceConflictError extends ConversationProjectionError {
  constructor(public readonly sequence: number) {
    super(
      "CONVERSATION_PROJECTION_SEQUENCE_CONFLICT",
      "Conversation Event sequence conflicts with an applied Event",
    );
    this.name = "ConversationProjectionSequenceConflictError";
  }
}

export class ConversationProjectionEventIdentityConflictError extends ConversationProjectionError {
  constructor(public readonly eventId: string) {
    super(
      "CONVERSATION_PROJECTION_EVENT_IDENTITY_CONFLICT",
      "Conversation Event identity appears at another sequence",
    );
    this.name = "ConversationProjectionEventIdentityConflictError";
  }
}

export class ConversationProjectionPayloadError extends ConversationProjectionError {
  constructor(eventType: string, detail: string) {
    super(
      "CONVERSATION_PROJECTION_PAYLOAD_INVALID",
      `Conversation projection cannot apply ${eventType}: ${detail}`,
    );
    this.name = "ConversationProjectionPayloadError";
  }
}

export class ConversationProjectionControllerStateError extends ConversationProjectionError {
  constructor(operation: string, state: string) {
    super(
      "CONVERSATION_PROJECTION_CONTROLLER_STATE_INVALID",
      `Conversation Projection Controller cannot ${operation} while ${state}`,
    );
    this.name = "ConversationProjectionControllerStateError";
  }
}

export class ConversationProjectionReplayError extends ConversationProjectionError {
  constructor() {
    super(
      "CONVERSATION_PROJECTION_REPLAY_INVALID",
      "Conversation replay did not reach the requested Journal high watermark",
    );
    this.name = "ConversationProjectionReplayError";
  }
}

export class ConversationProjectionSubscriptionEndedError extends ConversationProjectionError {
  constructor() {
    super(
      "CONVERSATION_PROJECTION_SUBSCRIPTION_ENDED",
      "Conversation Event subscription ended before the Controller stopped",
    );
    this.name = "ConversationProjectionSubscriptionEndedError";
  }
}
