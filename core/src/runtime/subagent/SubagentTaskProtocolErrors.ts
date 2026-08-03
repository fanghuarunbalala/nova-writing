/** Stable Subagent Task failures without prompts, results, Artifact data, or raw errors. */
export const SUBAGENT_TASK_PROTOCOL_FAILURE = Object.freeze({
  invalidDefinition: "invalid_definition",
  duplicateDefinition: "duplicate_definition",
  unknownDefinition: "unknown_definition",
  invalidLimits: "invalid_limits",
  invalidPolicy: "invalid_policy",
  invalidArguments: "invalid_arguments",
  invalidAcceptance: "invalid_acceptance",
  invalidSnapshot: "invalid_snapshot",
  invalidCancellation: "invalid_cancellation",
} as const);

export type SubagentTaskProtocolFailure =
  (typeof SUBAGENT_TASK_PROTOCOL_FAILURE)[keyof typeof SUBAGENT_TASK_PROTOCOL_FAILURE];

export class SubagentTaskProtocolError extends TypeError {
  override readonly name = "SubagentTaskProtocolError";
  readonly code = "SUBAGENT_TASK_PROTOCOL_INVALID" as const;

  constructor(
    readonly failure: SubagentTaskProtocolFailure,
    readonly taskId?: string,
    readonly agentType?: string,
  ) {
    super("Subagent Task protocol value is invalid");
  }
}
