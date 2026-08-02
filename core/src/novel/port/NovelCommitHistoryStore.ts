/** Atomic immutable Commit payload preparation and reconciliation boundary. */
import type {
  NovelCommitPayload,
  NovelCommitPayloadDigest,
  NovelCommitPayloadRef,
} from "../commit/index.js";
import type { NovelCommitId } from "../identity/index.js";

export interface PreparedNovelCommitPayload {
  readonly commitId: NovelCommitId;
  readonly payloadRef: NovelCommitPayloadRef;
  readonly payloadDigest: NovelCommitPayloadDigest;
  readonly payloadSize: number;
}

export interface NovelCommitHistoryReference extends PreparedNovelCommitPayload {}

export interface NovelCommitHistoryReconciliationResult {
  readonly removedTemporaryCount: number;
  readonly removedOrphanCount: number;
  readonly missing: readonly NovelCommitHistoryReference[];
}

export interface NovelCommitHistoryStore {
  prepare(payload: NovelCommitPayload): Promise<PreparedNovelCommitPayload>;
  verify(reference: NovelCommitHistoryReference): Promise<void>;
  reconcile(
    references: readonly NovelCommitHistoryReference[],
  ): Promise<NovelCommitHistoryReconciliationResult>;
}
