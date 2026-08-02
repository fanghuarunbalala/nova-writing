/** Validation failures for Tool execution contracts, with safe identities only. */
import type { ToolErrorIdentity } from "./ToolExecutionError.js";

export const TOOL_EXECUTION_PROTOCOL_FAILURE = {
  invalidInvocation: "invalid_invocation",
  invalidArgumentDigest: "invalid_argument_digest",
  invalidExecutionPolicy: "invalid_execution_policy",
  invalidPermissionDecision: "invalid_permission_decision",
  invalidApprovalIdentity: "invalid_approval_identity",
  invalidTraceRecord: "invalid_trace_record",
} as const;

export type ToolExecutionProtocolFailure =
  (typeof TOOL_EXECUTION_PROTOCOL_FAILURE)[keyof typeof TOOL_EXECUTION_PROTOCOL_FAILURE];

export class ToolExecutionProtocolError extends Error {
  override readonly name = "ToolExecutionProtocolError";
  readonly code = "TOOL_EXECUTION_PROTOCOL_FAILED" as const;
  readonly conversationId?: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolVersion?: string;

  constructor(
    public readonly failure: ToolExecutionProtocolFailure,
    identity: ToolErrorIdentity = {},
  ) {
    super("Tool execution protocol validation failed");
    this.conversationId = identity.conversationId;
    this.runId = identity.runId;
    this.toolCallId = identity.toolCallId;
    this.toolName = identity.toolName;
    this.toolVersion = identity.toolVersion;
  }
}
