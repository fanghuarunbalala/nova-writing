/** Stable typed errors for live Conversation Event delivery. */
export class ConversationEventFilterError extends TypeError {
  readonly code = "CONVERSATION_EVENT_FILTER_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ConversationEventFilterError";
  }
}

export class ConversationEventSubscriptionOptionsError extends TypeError {
  readonly code = "CONVERSATION_EVENT_SUBSCRIPTION_OPTIONS_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ConversationEventSubscriptionOptionsError";
  }
}

export class ConversationEventHubClosedError extends Error {
  readonly code = "CONVERSATION_EVENT_HUB_CLOSED";

  constructor() {
    super("Conversation Event Hub is closed");
    this.name = "ConversationEventHubClosedError";
  }
}

export class ConversationEventHubPublishError extends TypeError {
  readonly code = "CONVERSATION_EVENT_HUB_PUBLISH_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ConversationEventHubPublishError";
  }
}

export class ConversationEventHubSequenceError extends Error {
  readonly code = "CONVERSATION_EVENT_HUB_SEQUENCE_INVALID";

  constructor(
    public readonly conversationId: string,
    public readonly expectedSequence: number,
    public readonly actualSequence: number,
  ) {
    super(
      `Conversation Event Hub expected Sequence ${expectedSequence} but received ${actualSequence} for ${conversationId}`,
    );
    this.name = "ConversationEventHubSequenceError";
  }
}

export class ConversationEventSubscriptionClosedError extends Error {
  readonly code = "CONVERSATION_EVENT_SUBSCRIPTION_CLOSED";

  constructor(
    public readonly subscriptionId: string,
    public readonly conversationId: string,
  ) {
    super(`Conversation Event Subscription is closed: ${subscriptionId}`);
    this.name = "ConversationEventSubscriptionClosedError";
  }
}

export class ConversationEventSubscriptionOverflowError extends Error {
  readonly code = "CONVERSATION_EVENT_SUBSCRIPTION_OVERFLOW";

  constructor(
    public readonly subscriptionId: string,
    public readonly conversationId: string,
    public readonly capacity: number,
    public readonly lastDeliveredSequence: number,
  ) {
    super(`Conversation Event Subscription buffer overflowed: ${subscriptionId}`);
    this.name = "ConversationEventSubscriptionOverflowError";
  }
}

export class ConversationEventSubscriptionAbortedError extends Error {
  readonly code = "CONVERSATION_EVENT_SUBSCRIPTION_ABORTED";

  constructor(
    public readonly subscriptionId: string,
    public readonly conversationId: string,
    public readonly lastDeliveredSequence: number,
    options?: ErrorOptions,
  ) {
    super(`Conversation Event Subscription was aborted: ${subscriptionId}`, options);
    this.name = "ConversationEventSubscriptionAbortedError";
  }
}

export class ConversationEventSubscriptionConcurrentReadError extends Error {
  readonly code = "CONVERSATION_EVENT_SUBSCRIPTION_CONCURRENT_READ";

  constructor(
    public readonly subscriptionId: string,
    public readonly conversationId: string,
  ) {
    super(`Conversation Event Subscription does not allow concurrent reads: ${subscriptionId}`);
    this.name = "ConversationEventSubscriptionConcurrentReadError";
  }
}

export class ConversationEventSubscriptionCursorAheadError extends Error {
  readonly code = "CONVERSATION_EVENT_SUBSCRIPTION_CURSOR_AHEAD";

  constructor(
    public readonly conversationId: string,
    public readonly requestedSequence: number,
    public readonly journalHighWatermark: number,
  ) {
    super(
      `Conversation Event subscription cursor ${requestedSequence} is ahead of Journal High Watermark ${journalHighWatermark}`,
    );
    this.name = "ConversationEventSubscriptionCursorAheadError";
  }
}

export class ConversationEventSubscriptionServiceClosingError extends Error {
  readonly code = "CONVERSATION_EVENT_SUBSCRIPTION_SERVICE_CLOSING";

  constructor() {
    super("Conversation Event Subscription Service is closing");
    this.name = "ConversationEventSubscriptionServiceClosingError";
  }
}

export class ConversationEventSubscriptionServiceClosedError extends Error {
  readonly code = "CONVERSATION_EVENT_SUBSCRIPTION_SERVICE_CLOSED";

  constructor() {
    super("Conversation Event Subscription Service is closed");
    this.name = "ConversationEventSubscriptionServiceClosedError";
  }
}

export class ConversationJournalServiceClosingError extends Error {
  readonly code = "CONVERSATION_JOURNAL_SERVICE_CLOSING";

  constructor() {
    super("Conversation Journal Service is closing");
    this.name = "ConversationJournalServiceClosingError";
  }
}

export class ConversationJournalServiceClosedError extends Error {
  readonly code = "CONVERSATION_JOURNAL_SERVICE_CLOSED";

  constructor() {
    super("Conversation Journal Service is closed");
    this.name = "ConversationJournalServiceClosedError";
  }
}
