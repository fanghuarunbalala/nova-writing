/** Stable Tool protocol failures containing safe identities but no Tool data. */
export const TOOL_PROTOCOL_FAILURE = {
  invalidDescriptor: "invalid_descriptor",
  invalidName: "invalid_name",
  invalidVersion: "invalid_version",
  invalidSchema: "invalid_schema",
  invalidHandler: "invalid_handler",
  invalidResult: "invalid_result",
  invalidContent: "invalid_content",
  invalidDetails: "invalid_details",
  resultOversized: "result_oversized",
  artifactConversationMismatch: "artifact_conversation_mismatch",
  invalidProgress: "invalid_progress",
  invalidArguments: "invalid_arguments",
} as const;

export type ToolProtocolFailure =
  (typeof TOOL_PROTOCOL_FAILURE)[keyof typeof TOOL_PROTOCOL_FAILURE];

export interface ToolProtocolErrorIdentity {
  readonly toolName?: string;
  readonly toolVersion?: string;
  readonly conversationId?: string;
  readonly toolCallId?: string;
}

export class ToolProtocolError extends Error {
  override readonly name = "ToolProtocolError";
  readonly code = "TOOL_PROTOCOL_FAILED" as const;
  readonly toolName?: string;
  readonly toolVersion?: string;
  readonly conversationId?: string;
  readonly toolCallId?: string;

  constructor(
    public readonly failure: ToolProtocolFailure,
    identity: ToolProtocolErrorIdentity = {},
  ) {
    super("Tool protocol validation failed");
    this.toolName = identity.toolName;
    this.toolVersion = identity.toolVersion;
    this.conversationId = identity.conversationId;
    this.toolCallId = identity.toolCallId;
  }
}
