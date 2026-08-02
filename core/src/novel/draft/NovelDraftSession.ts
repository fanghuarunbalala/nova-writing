/** Immutable durable Draft Session protocol shared by application and adapters. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import {
  captureNovelDraftSessionId,
  captureNovelId,
  type NovelDraftSessionId,
  type NovelId,
} from "../identity/index.js";
import {
  captureNovelRevision,
  captureNovelTimestamp,
  type NovelRevision,
  type NovelTimestamp,
} from "../version/index.js";

export const NOVEL_DRAFT_SESSION_STATUS = {
  active: "active",
  awaitingApproval: "awaiting-approval",
  rebasing: "rebasing",
  conflicted: "conflicted",
  committing: "committing",
  committed: "committed",
  rolledBack: "rolled-back",
} as const;

export type NovelDraftSessionStatus =
  (typeof NOVEL_DRAFT_SESSION_STATUS)[keyof typeof NOVEL_DRAFT_SESSION_STATUS];

export interface NovelDraftSession {
  readonly id: NovelDraftSessionId;
  readonly novelId: NovelId;
  readonly ownerConversationId: string;
  readonly baseRevision: NovelRevision;
  readonly status: NovelDraftSessionStatus;
  readonly createdAt: NovelTimestamp;
  readonly updatedAt: NovelTimestamp;
  readonly terminalAt?: NovelTimestamp;
}

const DRAFT_SESSION_STATUSES = new Set<unknown>(
  Object.values(NOVEL_DRAFT_SESSION_STATUS),
);
const SAFE_CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export function captureNovelDraftSession(
  value: NovelDraftSession,
): NovelDraftSession {
  const status = captureNovelDraftSessionStatus(value.status);
  const terminalAt =
    value.terminalAt === undefined
      ? undefined
      : captureNovelTimestamp(value.terminalAt);
  if (isTerminalNovelDraftStatus(status) !== (terminalAt !== undefined)) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidDraftStatus,
      "draftStatus",
    );
  }

  return Object.freeze({
    id: captureNovelDraftSessionId(value.id),
    novelId: captureNovelId(value.novelId),
    ownerConversationId: captureNovelConversationId(value.ownerConversationId),
    baseRevision: captureNovelRevision(value.baseRevision),
    status,
    createdAt: captureNovelTimestamp(value.createdAt),
    updatedAt: captureNovelTimestamp(value.updatedAt),
    ...(terminalAt === undefined ? {} : { terminalAt }),
  });
}

export function captureNovelDraftSessionStatus(
  value: unknown,
): NovelDraftSessionStatus {
  if (!DRAFT_SESSION_STATUSES.has(value)) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidDraftStatus,
      "draftStatus",
    );
  }
  return value as NovelDraftSessionStatus;
}

export function captureNovelConversationId(value: unknown): string {
  if (typeof value !== "string" || !SAFE_CONVERSATION_ID.test(value)) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidIdentity,
      "conversationId",
    );
  }
  return value;
}

export function isTerminalNovelDraftStatus(
  status: NovelDraftSessionStatus,
): boolean {
  return (
    status === NOVEL_DRAFT_SESSION_STATUS.committed ||
    status === NOVEL_DRAFT_SESSION_STATUS.rolledBack
  );
}
