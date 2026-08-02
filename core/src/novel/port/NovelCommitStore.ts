/** Atomic canonical Commit replay, metadata, revision, and Outbox boundary. */
import type { NovelChangeSet, NovelCommit } from "../commit/index.js";
import type { NovelCommitHistoryReference } from "./NovelCommitHistoryStore.js";

export interface CommitNovelChangeSetInput<TContext> {
  readonly commit: NovelCommit;
  readonly changeSet: NovelChangeSet;
  readonly apply: (context: TContext) => void;
  readonly validate: (context: TContext) => void;
}

export interface NovelCommitStore<TContext> {
  listCommits(): Promise<readonly NovelCommit[]>;
  listHistoryReferences(): Promise<readonly NovelCommitHistoryReference[]>;
  commit(input: CommitNovelChangeSetInput<TContext>): Promise<"committed" | "duplicate">;
}
