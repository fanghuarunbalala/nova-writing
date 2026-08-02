/** Payload-free lifecycle failures shared by future Draft and Commit services. */
import type {
  NovelDraftSessionId,
  NovelId,
} from "../identity/index.js";
import type { NovelRevision } from "../version/index.js";

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

function captureSafeLifecycleState(value: unknown): string {
  return typeof value === "string" && DRAFT_LIFECYCLE_STATES.has(value)
    ? value
    : "unknown";
}
