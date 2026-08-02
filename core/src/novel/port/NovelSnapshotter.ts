/** Consistent canonical-to-Draft snapshot boundary without physical paths. */
import type { NovelDraftSession } from "../draft/index.js";
import type {
  NovelDraftSessionId,
  NovelId,
} from "../identity/index.js";
import type { NovelRevision } from "../version/index.js";

export interface NovelDraftSnapshot {
  readonly kind: "draft" | "rebase-candidate";
  readonly draftSessionId: NovelDraftSessionId;
  readonly novelId: NovelId;
  readonly ownerConversationId: string;
  readonly baseRevision: NovelRevision;
  readonly sourceDraftSessionId?: NovelDraftSessionId;
  readonly replacedBaseRevision?: NovelRevision;
}

export interface ReplaceNovelDraftSnapshotInput {
  readonly session: NovelDraftSession;
  readonly expectedBaseRevision: NovelRevision;
}

export interface CreateNovelRebaseCandidateSnapshotInput {
  readonly session: NovelDraftSession;
  readonly sourceDraftSessionId: NovelDraftSessionId;
}

export interface NovelSnapshotter {
  createDraftSnapshot(session: NovelDraftSession): Promise<void>;

  createRebaseCandidateSnapshot(
    input: CreateNovelRebaseCandidateSnapshotInput,
  ): Promise<void>;

  replaceDraftSnapshot(input: ReplaceNovelDraftSnapshotInput): Promise<void>;

  inspectDraftSnapshot(
    novelId: NovelId,
    draftSessionId: NovelDraftSessionId,
  ): Promise<NovelDraftSnapshot | undefined>;

  listDraftSnapshotIds(
    novelId: NovelId,
  ): Promise<readonly NovelDraftSessionId[]>;

  removeDraftSnapshot(
    novelId: NovelId,
    draftSessionId: NovelDraftSessionId,
  ): Promise<void>;
}
