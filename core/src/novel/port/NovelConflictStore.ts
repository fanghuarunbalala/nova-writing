/** Durable unresolved Conflict persistence inside a Rebase candidate Draft. */
import type {
  NovelConflictRecord,
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
}
