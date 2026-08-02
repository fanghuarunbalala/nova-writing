/** Canonical registry for fully rebuilt resolved sibling candidates. */
import type { NovelResolvedRebaseCandidate } from "../conflict/index.js";
import type { NovelDraftSessionId, NovelId } from "../identity/index.js";

export interface NovelResolvedRebaseCandidateStore {
  createResolvedCandidate(candidate: NovelResolvedRebaseCandidate): Promise<void>;
  getResolvedCandidate(
    novelId: NovelId,
    resolvedCandidateDraftSessionId: NovelDraftSessionId,
  ): Promise<NovelResolvedRebaseCandidate | undefined>;
  listResolvedCandidates(
    novelId: NovelId,
  ): Promise<readonly NovelResolvedRebaseCandidate[]>;
  removeResolvedCandidate(
    novelId: NovelId,
    resolvedCandidateDraftSessionId: NovelDraftSessionId,
  ): Promise<void>;
  close(): Promise<void>;
}
