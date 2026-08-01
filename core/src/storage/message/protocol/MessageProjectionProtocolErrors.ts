export interface MessageProjectionErrorContext {
  recordType?: string;
  recordIndex?: number;
  messageIndex?: number;
  sourceSequence?: number;
  conversationId?: string;
}

export class MessageProjectionProtocolError extends Error {
  constructor(
    message: string,
    public readonly context: MessageProjectionErrorContext = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MessageProjectionProtocolError";
  }
}

export class MessageProjectionFormatError extends MessageProjectionProtocolError {
  constructor(
    message: string,
    context: MessageProjectionErrorContext = {},
    options?: ErrorOptions,
  ) {
    super(message, context, options);
    this.name = "MessageProjectionFormatError";
  }
}

export class MessageProjectionHashMismatchError extends MessageProjectionProtocolError {
  constructor(context: MessageProjectionErrorContext = {}) {
    super("Message projection record hash does not match its canonical content", context);
    this.name = "MessageProjectionHashMismatchError";
  }
}

export class MessageProjectionChainMismatchError extends MessageProjectionProtocolError {
  constructor(context: MessageProjectionErrorContext = {}) {
    super("Message projection record does not continue the previous hash chain", context);
    this.name = "MessageProjectionChainMismatchError";
  }
}

export class MessageProjectionIdentityMismatchError extends MessageProjectionProtocolError {
  constructor(message: string, context: MessageProjectionErrorContext = {}) {
    super(message, context);
    this.name = "MessageProjectionIdentityMismatchError";
  }
}

export class MessageProjectionSequenceError extends MessageProjectionProtocolError {
  constructor(message: string, context: MessageProjectionErrorContext = {}) {
    super(message, context);
    this.name = "MessageProjectionSequenceError";
  }
}

export class MessageProjectionCheckpointError extends MessageProjectionProtocolError {
  constructor(message: string, context: MessageProjectionErrorContext = {}) {
    super(message, context);
    this.name = "MessageProjectionCheckpointError";
  }
}

export class MessageProjectionMessageInvalidError extends MessageProjectionProtocolError {
  constructor(
    context: MessageProjectionErrorContext = {},
    options?: ErrorOptions,
  ) {
    super("Message projection record contains an invalid Runtime Message", context, options);
    this.name = "MessageProjectionMessageInvalidError";
  }
}
