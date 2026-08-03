/** Stable child-management failures without objectives, policy contents, or raw causes. */
export const CHILD_CONVERSATION_MANAGER_FAILURE = Object.freeze({
  invalidParentScope: "invalid_parent_scope",
  parentScopeUnavailable: "parent_scope_unavailable",
  nestedSubagentForbidden: "nested_subagent_forbidden",
  toolPolicyUnavailable: "tool_policy_unavailable",
  toolPolicyExpansion: "tool_policy_expansion",
  duplicateSubagent: "duplicate_subagent",
  parentRunLimitExceeded: "parent_run_limit_exceeded",
  globalLimitExceeded: "global_limit_exceeded",
  childCreationFailed: "child_creation_failed",
  childBindingPersistenceFailed: "child_binding_persistence_failed",
  childTaskAssignmentFailed: "child_task_assignment_failed",
  childTaskAssignmentInvalid: "child_task_assignment_invalid",
  invalidChildCreation: "invalid_child_creation",
  childActivationFailed: "child_activation_failed",
  childRollbackFailed: "child_rollback_failed",
  bindingNotFound: "binding_not_found",
  bindingAlreadyTerminal: "binding_already_terminal",
  invalidTerminalTransition: "invalid_terminal_transition",
} as const);

export type ChildConversationManagerFailure =
  (typeof CHILD_CONVERSATION_MANAGER_FAILURE)[keyof typeof CHILD_CONVERSATION_MANAGER_FAILURE];

export interface ChildConversationManagerErrorIdentity {
  readonly subagentId?: string;
  readonly parentConversationId?: string;
  readonly parentRunId?: string;
  readonly childConversationId?: string;
}

export class ChildConversationManagerError extends Error {
  override readonly name = "ChildConversationManagerError";
  readonly code = "CHILD_CONVERSATION_MANAGER_FAILED" as const;
  readonly subagentId?: string;
  readonly parentConversationId?: string;
  readonly parentRunId?: string;
  readonly childConversationId?: string;

  constructor(
    readonly failure: ChildConversationManagerFailure,
    identity: ChildConversationManagerErrorIdentity = {},
  ) {
    super("Child Conversation management failed");
    this.subagentId = identity.subagentId;
    this.parentConversationId = identity.parentConversationId;
    this.parentRunId = identity.parentRunId;
    this.childConversationId = identity.childConversationId;
  }
}
