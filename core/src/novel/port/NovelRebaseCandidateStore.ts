/** Durable canonical registry for fully prepared sibling Rebase candidates. */
import type { NovelRebaseCandidate } from "../conflict/index.js";
import type {
  NovelDraftSessionId,
  NovelId,
} from "../identity/index.js";

export interface NovelRebaseCandidateStore {
  createCandidate(candidate: NovelRebaseCandidate): Promise<void>;

  getCandidate(
    novelId: NovelId,
    candidateDraftSessionId: NovelDraftSessionId,
  ): Promise<NovelRebaseCandidate | undefined>;

  listCandidates(novelId: NovelId): Promise<readonly NovelRebaseCandidate[]>;

  removeCandidate(
    novelId: NovelId,
    candidateDraftSessionId: NovelDraftSessionId,
  ): Promise<void>;

  close(): Promise<void>;
}
