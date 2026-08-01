/** Stable Assistant output bridge failures without Agent or content payloads. */
export const PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE = {
  invalidRequest: "invalid_request",
  turnMissing: "turn_missing",
  turnMismatch: "turn_mismatch",
  turnState: "turn_state",
  draftAlreadyActive: "draft_already_active",
  draftMissing: "draft_missing",
  draftStillActive: "draft_still_active",
  eventAppend: "event_append",
} as const;

export type PiAssistantOutputBridgeFailure =
  (typeof PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE)[keyof typeof PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE];

export class PiAssistantOutputBridgeError extends Error {
  override readonly name = "PiAssistantOutputBridgeError";
  readonly code = "PI_ASSISTANT_OUTPUT_BRIDGE_FAILED" as const;

  constructor(
    public readonly failure: PiAssistantOutputBridgeFailure,
    public readonly conversationId: string,
    public readonly runId?: string,
    public readonly turnId?: string,
    public readonly assistantMessageId?: string,
  ) {
    super("Pi Assistant output bridge failed");
  }
}
