/** Stable in-process Runtime lifecycle errors without raw failure content. */
import type { ConversationRuntimeState } from "./ConversationRuntimeState.js";

export const CONVERSATION_RUNTIME_OPERATION = {
  start: "start",
  dispatchInput: "dispatch_input",
  shutdown: "shutdown",
} as const;

export type ConversationRuntimeOperation =
  (typeof CONVERSATION_RUNTIME_OPERATION)[keyof typeof CONVERSATION_RUNTIME_OPERATION];

export class ConversationRuntimeStateError extends Error {
  readonly code = "CONVERSATION_RUNTIME_STATE_INVALID";

  constructor(
    public readonly conversationId: string,
    public readonly runtimeInstanceId: string,
    public readonly operation: ConversationRuntimeOperation,
    public readonly state: ConversationRuntimeState,
  ) {
    super(`Conversation Runtime cannot ${operation} while ${state}`);
    this.name = "ConversationRuntimeStateError";
  }
}

export class ConversationRuntimeStartError extends Error {
  readonly code = "CONVERSATION_RUNTIME_START_FAILED";

  constructor(
    public readonly conversationId: string,
    public readonly runtimeInstanceId: string,
    public readonly failureName: string,
    public readonly failureCode?: string,
  ) {
    super("Conversation Runtime startup failed");
    this.name = "ConversationRuntimeStartError";
  }
}

export class ConversationRuntimeDispatchFailureError extends Error {
  readonly code = "CONVERSATION_RUNTIME_INPUT_DISPATCH_FAILED";

  constructor(
    public readonly conversationId: string,
    public readonly runtimeInstanceId: string,
    public readonly failureName: string,
    public readonly failureCode?: string,
  ) {
    super("Conversation Runtime Input dispatch failed");
    this.name = "ConversationRuntimeDispatchFailureError";
  }
}

export type ConversationRuntimeInputPumpFailureScope =
  | "control"
  | "turn"
  | "scheduler"
  | "observer"
  | "unexpected_stop"
  | "shutdown";

export class ConversationRuntimeInputPumpError extends Error {
  override readonly name = "ConversationRuntimeInputPumpError";
  readonly code = "CONVERSATION_RUNTIME_INPUT_PUMP_FAILED" as const;

  constructor(
    public readonly conversationId: string,
    public readonly runtimeInstanceId: string,
    public readonly scope: ConversationRuntimeInputPumpFailureScope,
  ) {
    super("Conversation Runtime Input Pump failed");
  }
}
