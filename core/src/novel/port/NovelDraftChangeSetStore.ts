/** Durable ordered Draft Journal read and immutable ChangeSet freeze boundary. */
import type { NovelDraftSession } from "../draft/index.js";
import type { NovelChangeSetDigest, NovelChangeSetOperation } from "../commit/index.js";
import type { NovelTimestamp } from "../version/index.js";

export interface NovelDraftOperationSequence {
  readonly operationCount: number;
  readonly lastOperationSequence: number;
  readonly operations: readonly NovelChangeSetOperation[];
  readonly frozen?: {
    readonly digest: NovelChangeSetDigest;
    readonly frozenAt: NovelTimestamp;
  };
}

export interface FreezeNovelDraftChangeSetInput {
  readonly session: NovelDraftSession;
  readonly expectedOperationCount: number;
  readonly expectedLastOperationSequence: number;
  readonly digest: NovelChangeSetDigest;
  readonly frozenAt: NovelTimestamp;
}

export interface NovelDraftChangeSetStore {
  readOperationSequence(
    session: NovelDraftSession,
  ): Promise<NovelDraftOperationSequence>;
  freezeChangeSet(input: FreezeNovelDraftChangeSetInput): Promise<{
    readonly digest: NovelChangeSetDigest;
    readonly frozenAt: NovelTimestamp;
  }>;
}
