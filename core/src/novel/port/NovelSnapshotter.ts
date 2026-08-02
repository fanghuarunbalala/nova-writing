/** Consistent canonical-to-Draft snapshot boundary without physical paths. */
import type { NovelDraftSession } from "../draft/index.js";
import type {
  NovelDraftSessionId,
  NovelId,
} from "../identity/index.js";
import type { NovelRevision } from "../version/index.js";

export interface NovelDraftSnapshot {
  readonly draftSessionId: NovelDraftSessionId;
  readonly novelId: NovelId;
  readonly ownerConversationId: string;
  readonly baseRevision: NovelRevision;
  readonly replacedBaseRevision?: NovelRevision;
}

export interface ReplaceNovelDraftSnapshotInput {
  readonly session: NovelDraftSession;
  readonly expectedBaseRevision: NovelRevision;
}

export interface NovelSnapshotter {
  createDraftSnapshot(session: NovelDraftSession): Promise<void>;

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
