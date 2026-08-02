/** Canonical persistence boundary for durable Draft Session lifecycle records. */
import type {
  NovelDraftSession,
  NovelDraftSessionStatus,
} from "../draft/index.js";
import type {
  NovelDraftSessionId,
  NovelId,
} from "../identity/index.js";
import type { NovelRevision, NovelTimestamp } from "../version/index.js";

export interface ResetNovelDraftRecordInput {
  readonly novelId: NovelId;
  readonly draftSessionId: NovelDraftSessionId;
  readonly expectedBaseRevision: NovelRevision;
  readonly expectedStatuses: readonly NovelDraftSessionStatus[];
  readonly baseRevision: NovelRevision;
  readonly resetAt: NovelTimestamp;
}

export interface RollbackNovelDraftRecordInput {
  readonly novelId: NovelId;
  readonly draftSessionId: NovelDraftSessionId;
  readonly expectedStatuses: readonly NovelDraftSessionStatus[];
  readonly rolledBackAt: NovelTimestamp;
}

export interface NovelDraftStore {
  createDraftSession(session: NovelDraftSession): Promise<void>;

  getDraftSession(
    novelId: NovelId,
    draftSessionId: NovelDraftSessionId,
  ): Promise<NovelDraftSession | undefined>;

  getActiveDraftSession(
    novelId: NovelId,
    ownerConversationId: string,
  ): Promise<NovelDraftSession | undefined>;

  listDraftSessions(novelId: NovelId): Promise<readonly NovelDraftSession[]>;

  resetDraftSession(input: ResetNovelDraftRecordInput): Promise<NovelDraftSession>;

  rollbackDraftSession(
    input: RollbackNovelDraftRecordInput,
  ): Promise<NovelDraftSession>;

  close(): Promise<void>;
}
