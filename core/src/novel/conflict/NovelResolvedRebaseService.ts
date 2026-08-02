/** Replays an immutable Resolution Plan into a fresh durable sibling candidate. */
import { noopLogger, type Logger } from "../../observability/index.js";
import { NOVEL_DRAFT_SESSION_STATUS, captureNovelDraftSession } from "../draft/index.js";
import { NovelInvariantViolationError, NovelRevisionConflictError, NOVEL_INVARIANT_FAILURE } from "../error/index.js";
import type { NovelIdentityFactory } from "../identity/index.js";
import type { NovelOperationExecutor } from "../operation/index.js";
import type {
  NovelCanonicalStore,
  NovelClock,
  NovelDraftChangeSetStore,
  NovelDraftOperationStore,
  NovelResolutionApplicationPlanStore,
  NovelResolvedRebaseCandidateStore,
  NovelSnapshotter,
} from "../port/index.js";
import { captureNovelRebaseCandidate, type NovelRebaseCandidate } from "./NovelRebaseCandidate.js";
import { captureNovelResolvedRebaseCandidate, type NovelResolvedRebaseCandidate } from "./NovelResolvedRebaseCandidate.js";

export interface NovelResolvedRebaseServiceOptions<TContext> {
  readonly canonicalStore: NovelCanonicalStore;
  readonly snapshotter: NovelSnapshotter;
  readonly operationStore: NovelDraftOperationStore<TContext> & NovelDraftChangeSetStore;
  readonly executor: NovelOperationExecutor<TContext>;
  readonly planStore: NovelResolutionApplicationPlanStore;
  readonly resolvedCandidateStore: NovelResolvedRebaseCandidateStore;
  readonly identityFactory: Pick<NovelIdentityFactory, "createDraftSessionId">;
  readonly clock: NovelClock;
  readonly logger?: Logger;
}

export class NovelResolvedRebaseService<TContext> {
  private readonly logger: Logger;
  constructor(private readonly options: NovelResolvedRebaseServiceOptions<TContext>) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_resolved_rebase_service",
    });
  }

  async prepareResolvedCandidate(
    candidateInput: NovelRebaseCandidate,
  ): Promise<NovelResolvedRebaseCandidate> {
    const candidate = captureNovelRebaseCandidate(candidateInput);
    const canonical = await this.options.canonicalStore.getMetadata();
    if (canonical.currentRevision !== candidate.session.baseRevision) {
      throw new NovelRevisionConflictError(
        canonical.novelId,
        candidate.session.baseRevision,
        canonical.currentRevision,
        candidate.session.id,
      );
    }
    const plan = await this.options.planStore.getPlan(candidate.session);
    if (
      plan === undefined ||
      plan.sourceDraftSessionId !== candidate.sourceDraftSessionId ||
      plan.conflictedCandidateDraftSessionId !== candidate.session.id ||
      plan.baseRevision !== canonical.currentRevision
    ) {
      throw corrupt(candidate);
    }
    const preparedAt = this.options.clock.now();
    const session = captureNovelDraftSession({
      id: this.options.identityFactory.createDraftSessionId(),
      novelId: candidate.session.novelId,
      ownerConversationId: candidate.session.ownerConversationId,
      baseRevision: canonical.currentRevision,
      status: NOVEL_DRAFT_SESSION_STATUS.rebasing,
      createdAt: preparedAt,
      updatedAt: preparedAt,
    });
    let registered = false;
    try {
      await this.options.snapshotter.createRebaseCandidateSnapshot({
        session,
        sourceDraftSessionId: candidate.sourceDraftSessionId,
      });
      let effectiveSequence = 0;
      for (const entry of plan.entries) {
        if (entry.action === "skip") continue;
        const receipt = await this.options.operationStore.appendOperation({
          session,
          operation: entry.operation,
          digest: entry.operationDigest,
          recordedAt: this.options.clock.now(),
          apply: (context) => this.options.executor.executeSynchronous(context, entry.operation),
        });
        effectiveSequence += 1;
        if (
          receipt.status !== "appended" ||
          receipt.sequence !== effectiveSequence ||
          receipt.digest !== entry.operationDigest
        ) throw corrupt(candidate);
      }
      const replayed = await this.options.operationStore.readOperationSequence(session);
      if (
        replayed.operationCount !== plan.effectiveOperationCount ||
        replayed.lastOperationSequence !== plan.effectiveOperationCount
      ) throw corrupt(candidate);
      const resolved = captureNovelResolvedRebaseCandidate({
        sourceDraftSessionId: candidate.sourceDraftSessionId,
        conflictedCandidateDraftSessionId: candidate.session.id,
        resolutionPlanDigest: plan.digest,
        session,
        operationCount: replayed.operationCount,
        lastOperationSequence: replayed.lastOperationSequence,
        preparedAt,
      });
      await this.options.resolvedCandidateStore.createResolvedCandidate(resolved);
      registered = true;
      this.logger.info("novel_resolved_candidate.prepare.completed", {
        sourceDraftSessionId: candidate.sourceDraftSessionId,
        conflictedCandidateDraftSessionId: candidate.session.id,
        resolvedCandidateDraftSessionId: session.id,
        operationCount: resolved.operationCount,
      });
      return resolved;
    } catch (error) {
      if (!registered) {
        await this.options.snapshotter.removeDraftSnapshot(session.novelId, session.id).catch(() => undefined);
      }
      throw error;
    }
  }
}

function corrupt(candidate: NovelRebaseCandidate): NovelInvariantViolationError {
  return new NovelInvariantViolationError(
    NOVEL_INVARIANT_FAILURE.persistenceInvariant,
    candidate.session.novelId,
    candidate.session.id,
  );
}
