/** Stable Runtime Bootstrap rejection errors without Event payload details. */
import type { ConversationStatus } from "../../storage/index.js";

export type ConversationRuntimeBootstrapValidationReason =
  | "invalid_request"
  | "snapshot_conversation_mismatch"
  | "snapshot_agent_binding_mismatch";

export class ConversationRuntimeBootstrapValidationError extends Error {
  readonly code = "CONVERSATION_RUNTIME_BOOTSTRAP_INVALID";

  constructor(public readonly reason: ConversationRuntimeBootstrapValidationReason) {
    super(`Conversation Runtime Bootstrap request is invalid: ${reason}`);
    this.name = "ConversationRuntimeBootstrapValidationError";
  }
}

export class ConversationRuntimeBootstrapConversationNotActiveError extends Error {
  readonly code = "CONVERSATION_RUNTIME_BOOTSTRAP_CONVERSATION_NOT_ACTIVE";

  constructor(
    public readonly conversationId: string,
    public readonly status: Exclude<ConversationStatus, "active">,
  ) {
    super(`Conversation is not active for Runtime Bootstrap: ${conversationId}`);
    this.name = "ConversationRuntimeBootstrapConversationNotActiveError";
  }
}

export class ConversationRuntimeBootstrapWorkspaceMismatchError extends Error {
  readonly code = "CONVERSATION_RUNTIME_BOOTSTRAP_WORKSPACE_MISMATCH";

  constructor(
    public readonly conversationId: string,
    public readonly expectedWorkspaceId: string,
    public readonly receivedWorkspaceId: string,
  ) {
    super(`Conversation Workspace does not match Runtime Bootstrap Workspace: ${conversationId}`);
    this.name = "ConversationRuntimeBootstrapWorkspaceMismatchError";
  }
}

export class ConversationRuntimeBootstrapInputNotFoundError extends Error {
  readonly code = "CONVERSATION_RUNTIME_BOOTSTRAP_INPUT_NOT_FOUND";

  constructor(
    public readonly conversationId: string,
    public readonly sequence: number,
  ) {
    super(`Runtime Bootstrap InputEvent was not found: ${conversationId}/${sequence}`);
    this.name = "ConversationRuntimeBootstrapInputNotFoundError";
  }
}

export class ConversationRuntimeBootstrapInputMismatchError extends Error {
  readonly code = "CONVERSATION_RUNTIME_BOOTSTRAP_INPUT_MISMATCH";

  constructor(
    public readonly conversationId: string,
    public readonly sequence: number,
    public readonly field: string,
  ) {
    super(`Runtime Bootstrap InputEvent reference does not match durable Event: ${field}`);
    this.name = "ConversationRuntimeBootstrapInputMismatchError";
  }
}

export class ConversationRuntimeBootstrapHighWatermarkError extends Error {
  readonly code = "CONVERSATION_RUNTIME_BOOTSTRAP_HIGH_WATERMARK_INVALID";

  constructor(
    public readonly conversationId: string,
    public readonly highWatermark: number,
  ) {
    super(`Runtime Bootstrap Journal High Watermark is invalid: ${conversationId}`);
    this.name = "ConversationRuntimeBootstrapHighWatermarkError";
  }
}
