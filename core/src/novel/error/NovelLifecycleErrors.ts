/** Payload-free lifecycle failures shared by future Draft and Commit services. */
import type {
  NovelDraftSessionId,
  NovelId,
  NovelOperationId,
} from "../identity/index.js";
import type {
  NovelOperationVersion,
  NovelRevision,
} from "../version/index.js";

export const NOVEL_INVARIANT_FAILURE = {
  workspaceIdentityMismatch: "workspace_identity_mismatch",
  novelIdentityMismatch: "novel_identity_mismatch",
  invalidStateTransition: "invalid_state_transition",
  operationRejected: "operation_rejected",
  persistenceInvariant: "persistence_invariant",
} as const;

export type NovelInvariantFailure =
  (typeof NOVEL_INVARIANT_FAILURE)[keyof typeof NOVEL_INVARIANT_FAILURE];

const DRAFT_LIFECYCLE_STATES = new Set([
  "active",
  "awaiting-approval",
  "rebasing",
  "conflicted",
  "committing",
  "committed",
  "rolled-back",
]);

export class NovelDraftSessionNotFoundError extends Error {
  override readonly name = "NovelDraftSessionNotFoundError";
  readonly code = "NOVEL_DRAFT_SESSION_NOT_FOUND" as const;

  constructor(public readonly draftSessionId: NovelDraftSessionId) {
    super("Novel Draft Session was not found");
  }
}

export class NovelDraftAlreadyActiveError extends Error {
  override readonly name = "NovelDraftAlreadyActiveError";
  readonly code = "NOVEL_DRAFT_ALREADY_ACTIVE" as const;

  constructor(
    public readonly novelId: NovelId,
    public readonly ownerConversationId: string,
    public readonly draftSessionId: NovelDraftSessionId,
  ) {
    super("Conversation already owns an active Novel Draft Session");
  }
}

export const NOVEL_SNAPSHOT_FAILURE = {
  alreadyExists: "already_exists",
  missing: "missing",
  invalid: "invalid",
  createFailed: "create_failed",
  replaceFailed: "replace_failed",
  removeFailed: "remove_failed",
} as const;

export type NovelSnapshotFailure =
  (typeof NOVEL_SNAPSHOT_FAILURE)[keyof typeof NOVEL_SNAPSHOT_FAILURE];

export class NovelSnapshotError extends Error {
  override readonly name = "NovelSnapshotError";
  readonly code = "NOVEL_SNAPSHOT_FAILED" as const;

  constructor(
    public readonly failure: NovelSnapshotFailure,
    public readonly novelId: NovelId,
    public readonly draftSessionId: NovelDraftSessionId,
  ) {
    super("Novel Draft snapshot operation failed");
  }
}

export class NovelDraftSessionStateError extends Error {
  override readonly name = "NovelDraftSessionStateError";
  readonly code = "NOVEL_DRAFT_SESSION_STATE_INVALID" as const;
  readonly expectedStates: readonly string[];
  readonly actualState: string;

  constructor(
    public readonly draftSessionId: NovelDraftSessionId,
    expectedStates: readonly string[],
    actualState: string,
  ) {
    super("Novel Draft Session state is invalid");
    this.expectedStates = Object.freeze(
      expectedStates.map(captureSafeLifecycleState),
    );
    this.actualState = captureSafeLifecycleState(actualState);
  }
}

export class NovelRevisionConflictError extends Error {
  override readonly name = "NovelRevisionConflictError";
  readonly code = "NOVEL_REVISION_CONFLICT" as const;

  constructor(
    public readonly novelId: NovelId,
    public readonly expectedRevision: NovelRevision,
    public readonly actualRevision: NovelRevision,
    public readonly draftSessionId?: NovelDraftSessionId,
  ) {
    super("Novel revision conflict");
  }
}

export class NovelInvariantViolationError extends Error {
  override readonly name = "NovelInvariantViolationError";
  readonly code = "NOVEL_INVARIANT_VIOLATED" as const;

  constructor(
    public readonly failure: NovelInvariantFailure,
    public readonly novelId?: NovelId,
    public readonly draftSessionId?: NovelDraftSessionId,
  ) {
    super("Novel invariant violated");
  }
}

export class NovelOperationRegistrationError extends Error {
  override readonly name = "NovelOperationRegistrationError";
  readonly code = "NOVEL_OPERATION_ALREADY_REGISTERED" as const;

  constructor(
    public readonly operationType: string,
    public readonly operationVersion: NovelOperationVersion,
  ) {
    super("Novel Operation handler is already registered");
  }
}

export class NovelOperationHandlerNotFoundError extends Error {
  override readonly name = "NovelOperationHandlerNotFoundError";
  readonly code = "NOVEL_OPERATION_HANDLER_NOT_FOUND" as const;

  constructor(
    public readonly operationType: string,
    public readonly operationVersion: NovelOperationVersion,
  ) {
    super("Novel Operation handler was not found");
  }
}

export class NovelOperationSynchronousHandlerError extends Error {
  override readonly name = "NovelOperationSynchronousHandlerError";
  readonly code = "NOVEL_OPERATION_HANDLER_NOT_SYNCHRONOUS" as const;

  constructor(
    public readonly operationType: string,
    public readonly operationVersion: NovelOperationVersion,
  ) {
    super("Novel Operation handler must complete synchronously");
  }
}

export class NovelOperationIdentityConflictError extends Error {
  override readonly name = "NovelOperationIdentityConflictError";
  readonly code = "NOVEL_OPERATION_IDENTITY_CONFLICT" as const;

  constructor(
    public readonly operationId: NovelOperationId,
    public readonly draftSessionId: NovelDraftSessionId,
  ) {
    super("Novel Operation identity conflicts with durable content");
  }
}

export class NovelDraftOperationPersistenceError extends Error {
  override readonly name = "NovelDraftOperationPersistenceError";
  readonly code = "NOVEL_DRAFT_OPERATION_PERSISTENCE_FAILED" as const;

  constructor(
    public readonly draftSessionId: NovelDraftSessionId,
    public readonly operationId?: NovelOperationId,
  ) {
    super("Novel Draft Operation persistence failed");
  }
}

function captureSafeLifecycleState(value: unknown): string {
  return typeof value === "string" && DRAFT_LIFECYCLE_STATES.has(value)
    ? value
    : "unknown";
}
