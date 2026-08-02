/** Promotes a rebuilt resolved sibling into the owner's active Draft slot. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { NovelClock, NovelResolvedRebaseCandidateStore } from "../port/index.js";
import {
  captureNovelResolvedRebaseCandidate,
  type NovelResolvedRebaseCandidate,
  type NovelResolvedRebasePromotionResult,
} from "./NovelResolvedRebaseCandidate.js";

export interface NovelResolvedRebasePromotionServiceOptions {
  readonly store: NovelResolvedRebaseCandidateStore;
  readonly clock: NovelClock;
  readonly logger?: Logger;
}

export class NovelResolvedRebasePromotionService {
  private readonly logger: Logger;

  constructor(
    private readonly options: NovelResolvedRebasePromotionServiceOptions,
  ) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_resolved_rebase_promotion_service",
    });
  }

  async promote(
    candidateInput: NovelResolvedRebaseCandidate,
  ): Promise<NovelResolvedRebasePromotionResult> {
    const candidate = captureNovelResolvedRebaseCandidate(candidateInput);
    const result = await this.options.store.promoteResolvedCandidate(
      candidate,
      this.options.clock.now(),
    );
    this.logger.info("novel_resolved_candidate.promotion.completed", {
      sourceDraftSessionId: candidate.sourceDraftSessionId,
      resolvedCandidateDraftSessionId: candidate.session.id,
      status: result.status,
    });
    return result;
  }
}
