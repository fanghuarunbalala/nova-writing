/** Produces content-safe hashes for Rebase conflict evidence. */
import type { NovelDraftSession } from "../draft/index.js";
import type {
  NovelConflict,
  NovelConflictDigest,
} from "../conflict/index.js";
import type { NovelOperationPrecondition } from "../operation/index.js";

export interface NovelConflictDigester {
  digestPrecondition(
    precondition: NovelOperationPrecondition,
  ): Promise<NovelConflictDigest>;

  digestEntitySnapshot(
    session: NovelDraftSession,
    entityType: string,
    entityId: string,
  ): Promise<NovelConflictDigest>;

  digestConflict(conflict: NovelConflict): Promise<NovelConflictDigest>;
}
