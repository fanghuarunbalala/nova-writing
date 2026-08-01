/** Stable Runtime Event append failure without payloads or raw publisher errors. */
export const RUNTIME_EVENT_APPEND_FAILURE = {
  rejected: "rejected",
  conflict: "conflict",
  persistenceFailed: "persistence_failed",
  invalidReceipt: "invalid_receipt",
  publisherFailed: "publisher_failed",
} as const;

export type RuntimeEventAppendFailure =
  (typeof RUNTIME_EVENT_APPEND_FAILURE)[keyof typeof RUNTIME_EVENT_APPEND_FAILURE];

export class RuntimeEventAppendError extends Error {
  readonly code = "RUNTIME_EVENT_APPEND_FAILED";

  constructor(
    public readonly conversationId: string,
    public readonly eventId: string,
    public readonly eventType: string,
    public readonly failure: RuntimeEventAppendFailure,
  ) {
    super(`Runtime Event append failed: ${failure}`);
    this.name = "RuntimeEventAppendError";
  }
}
