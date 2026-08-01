/** Stable Core-to-Pi Message conversion failures without Message contents. */
export const CORE_PI_MESSAGE_CONVERSION_FAILURE = {
  invalidRequest: "invalid_request",
  invalidMessage: "invalid_message",
  unsupportedMessage: "unsupported_message",
  duplicateMessage: "duplicate_message",
  assistantEnvelopeUnavailable: "assistant_envelope_unavailable",
  assistantEnvelopeInvalid: "assistant_envelope_invalid",
} as const;

export type CorePiMessageConversionFailure =
  (typeof CORE_PI_MESSAGE_CONVERSION_FAILURE)[keyof typeof CORE_PI_MESSAGE_CONVERSION_FAILURE];

export class CorePiRuntimeMessageConversionError extends Error {
  override readonly name = "CorePiRuntimeMessageConversionError";
  readonly code = "CORE_PI_RUNTIME_MESSAGE_CONVERSION_FAILED" as const;

  constructor(
    public readonly failure: CorePiMessageConversionFailure,
    public readonly conversationId?: string,
    public readonly runId?: string,
  ) {
    super("Runtime Message conversion failed");
  }
}
