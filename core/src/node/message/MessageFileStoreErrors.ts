import type { MessageProjectionFileStatus } from "../../storage/index.js";

export class MessageFileStoreClosedError extends Error {
  constructor() {
    super("Conversation Message file store is closed");
    this.name = "MessageFileStoreClosedError";
  }
}

export class MessageProjectionFileMissingError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Message projection file is missing for Conversation: ${conversationId}`);
    this.name = "MessageProjectionFileMissingError";
  }
}

export class MessageProjectionFileAlreadyExistsError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Message projection file already exists for Conversation: ${conversationId}`);
    this.name = "MessageProjectionFileAlreadyExistsError";
  }
}

export class MessageProjectionFileStateError extends Error {
  constructor(
    public readonly conversationId: string,
    public readonly status: MessageProjectionFileStatus,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MessageProjectionFileStateError";
  }
}

export class MessageProjectionFileLockTimeoutError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Timed out waiting for Message projection lock: ${conversationId}`);
    this.name = "MessageProjectionFileLockTimeoutError";
  }
}

export class MessageProjectionFileStaleScanError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Message projection Scan is stale: ${conversationId}`);
    this.name = "MessageProjectionFileStaleScanError";
  }
}

export class MessageProjectionFileChangedDuringScanError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Message projection file changed during Scan: ${conversationId}`);
    this.name = "MessageProjectionFileChangedDuringScanError";
  }
}

export class MessageProjectionFileOperationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MessageProjectionFileOperationError";
  }
}
