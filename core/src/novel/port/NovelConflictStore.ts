/** Durable unresolved Conflict persistence inside a Rebase candidate Draft. */
import type {
  NovelConflictRecord,
  NovelConflictResolutionRecord,
  NovelConflictDigest,
} from "../conflict/index.js";
import type { NovelDraftSession } from "../draft/index.js";

export interface NovelConflictStore {
  recordConflict(
    session: NovelDraftSession,
    record: NovelConflictRecord,
  ): Promise<"recorded" | "duplicate">;

  listConflicts(
    session: NovelDraftSession,
  ): Promise<readonly NovelConflictRecord[]>;

  resolveConflict(
    session: NovelDraftSession,
    resolution: NovelConflictResolutionRecord,
    digest: NovelConflictDigest,
  ): Promise<"resolved" | "duplicate">;

  listResolutions(
    session: NovelDraftSession,
  ): Promise<readonly NovelConflictResolutionRecord[]>;
}
