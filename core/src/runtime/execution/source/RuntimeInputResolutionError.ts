/** Stable Runtime Input resolution failure without payloads or raw Journal errors. */
export const RUNTIME_INPUT_RESOLUTION_FAILURE = {
  invalidReference: "invalid_reference",
  notFound: "not_found",
  directionMismatch: "direction_mismatch",
  identityMismatch: "identity_mismatch",
  invalidEvent: "invalid_event",
  readFailed: "read_failed",
} as const;

export type RuntimeInputResolutionFailure =
  (typeof RUNTIME_INPUT_RESOLUTION_FAILURE)[keyof typeof RUNTIME_INPUT_RESOLUTION_FAILURE];

export class RuntimeInputResolutionError extends Error {
  readonly code = "RUNTIME_INPUT_RESOLUTION_FAILED";

  constructor(
    public readonly conversationId: string,
    public readonly sequence: number,
    public readonly failure: RuntimeInputResolutionFailure,
  ) {
    super(`Runtime Input resolution failed: ${failure}`);
    this.name = "RuntimeInputResolutionError";
  }
}
