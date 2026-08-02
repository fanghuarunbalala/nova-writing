/** Stable child-process placement failures without raw process diagnostics. */
export class NodeConversationProcessSupervisorClosedError extends Error {
  readonly code = "NODE_CONVERSATION_PROCESS_SUPERVISOR_CLOSED";

  constructor() {
    super("Conversation process supervisor is closed");
    this.name = "NodeConversationProcessSupervisorClosedError";
  }
}

export class NodeConversationProcessSupervisorCloseError extends Error {
  readonly code = "NODE_CONVERSATION_PROCESS_SUPERVISOR_CLOSE_FAILED";

  constructor(readonly failureCount: number) {
    super("Conversation process supervisor close failed");
    this.name = "NodeConversationProcessSupervisorCloseError";
  }
}

export class NodeConversationProcessConflictError extends Error {
  readonly code = "NODE_CONVERSATION_PROCESS_CONFLICT";

  constructor(
    readonly conversationId: string,
    readonly runtimeInstanceId: string,
  ) {
    super("Conversation Runtime already has a child-process placement");
    this.name = "NodeConversationProcessConflictError";
  }
}

export class NodeConversationProcessActivationError extends Error {
  readonly code = "NODE_CONVERSATION_PROCESS_ACTIVATION_FAILED";

  constructor(
    readonly conversationId: string,
    readonly runtimeInstanceId: string,
    readonly stage: "launch" | "connect",
    readonly errorName: string,
    readonly errorCode?: string,
  ) {
    super("Conversation child-process activation failed");
    this.name = "NodeConversationProcessActivationError";
  }
}

export class RuntimeChildProcessLaunchError extends Error {
  readonly code = "RUNTIME_CHILD_PROCESS_LAUNCH_FAILED";

  constructor(
    readonly errorName: string,
    readonly errorCode?: string,
  ) {
    super("Runtime child process launch failed");
    this.name = "RuntimeChildProcessLaunchError";
  }
}

export class ChildProcessConversationRuntimeHandleError extends Error {
  readonly code = "CHILD_PROCESS_CONVERSATION_RUNTIME_HANDLE_FAILED";

  constructor(
    readonly conversationId: string,
    readonly runtimeInstanceId: string,
    readonly operation: "dispatch_input" | "shutdown",
  ) {
    super("Child-process Conversation Runtime command failed");
    this.name = "ChildProcessConversationRuntimeHandleError";
  }
}
