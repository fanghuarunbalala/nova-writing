/** Stable Subagent protocol failures without objectives, summaries, or raw errors. */
export const SUBAGENT_PROTOCOL_FAILURE = Object.freeze({
  invalidRequest: "invalid_request",
  invalidBinding: "invalid_binding",
  invalidResult: "invalid_result",
  identityMismatch: "identity_mismatch",
  invalidTransition: "invalid_transition",
} as const);

export type SubagentProtocolFailure =
  (typeof SUBAGENT_PROTOCOL_FAILURE)[keyof typeof SUBAGENT_PROTOCOL_FAILURE];

export class SubagentProtocolError extends TypeError {
  readonly code = "SUBAGENT_PROTOCOL_INVALID";

  constructor(
    readonly failure: SubagentProtocolFailure,
    readonly subagentId?: string,
  ) {
    super("Subagent protocol value is invalid");
    this.name = "SubagentProtocolError";
  }
}
