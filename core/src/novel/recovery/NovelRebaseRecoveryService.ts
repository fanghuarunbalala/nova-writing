/** Reconciles registered Rebase candidates with their durable Draft snapshots. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  isTerminalNovelDraftStatus,
  type NovelDraftSession,
} from "../draft/index.js";
import type {
  NovelRebaseCandidate,
  NovelResolvedRebaseCandidate,
} from "../conflict/index.js";
import {
  captureNovelId,
  type NovelId,
} from "../identity/index.js";
import type {
  NovelDraftChangeSetStore,
  NovelDraftStore,
  NovelRebaseCandidateStore,
  NovelResolutionApplicationPlanStore,
  NovelResolvedRebaseCandidateStore,
  NovelSnapshotter,
} from "../port/index.js";
import {
  NOVEL_RECOVERY_PHASE,
  captureNovelRecoveryPhaseResult,
  type NovelRecoveryPhaseResult,
} from "./NovelRecovery.js";
import type { NovelRecoveryStage } from "./NovelRecoveryCoordinator.js";

export interface NovelRebaseRecoveryServiceOptions {
  readonly draftStore: Pick<NovelDraftStore, "getDraftSession">;
  readonly snapshotter: Pick<
    NovelSnapshotter,
    "inspectDraftSnapshot" | "removeDraftSnapshot"
  >;
  readonly candidateStore: Pick<
    NovelRebaseCandidateStore,
    "listCandidates" | "removeCandidate"
  >;
  readonly resolvedCandidateStore: Pick<
    NovelResolvedRebaseCandidateStore,
    "listResolvedCandidates" | "removeResolvedCandidate"
  >;
  readonly operationStore: Pick<NovelDraftChangeSetStore, "readOperationSequence">;
  readonly resolutionPlanStore: Pick<
    NovelResolutionApplicationPlanStore,
    "getPlan"
  >;
  readonly logger?: Logger;
}

export class NovelRebaseRecoveryService implements NovelRecoveryStage {
  readonly phase = NOVEL_RECOVERY_PHASE.rebase;
  private readonly logger: Logger;

  constructor(private readonly options: NovelRebaseRecoveryServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_rebase_recovery_service",
    });
  }

  async recover(novelIdInput: NovelId): Promise<NovelRecoveryPhaseResult> {
    const novelId = captureNovelId(novelIdInput);
    this.logger.info("novel_rebase_recovery.started", { novelId });
    const candidates = await this.options.candidateStore.listCandidates(novelId);
    const resolvedCandidates =
      await this.options.resolvedCandidateStore.listResolvedCandidates(novelId);
    const candidateValidity = new Map<string, boolean>();
    let retainedCount = 0;
    let removedCount = 0;

    for (const candidate of candidates) {
      const valid = await this.isCandidateValid(candidate);
      candidateValidity.set(candidate.session.id, valid);
    }
    for (const candidate of resolvedCandidates) {
      if (await this.isResolvedCandidateValid(candidate, candidates, candidateValidity)) {
        retainedCount += 1;
      } else {
        await this.removeResolvedCandidate(candidate);
        removedCount += 1;
      }
    }
    for (const candidate of candidates) {
      if (candidateValidity.get(candidate.session.id) === true) {
        retainedCount += 1;
      } else {
        await this.removeCandidate(candidate);
        removedCount += 1;
      }
    }

    const result = captureNovelRecoveryPhaseResult({
      phase: this.phase,
      inspectedCount: candidates.length + resolvedCandidates.length,
      repairedCount: 0,
      removedCount,
      retainedCount,
      publishedCount: 0,
    });
    this.logger.info("novel_rebase_recovery.completed", {
      novelId,
      inspectedCount: result.inspectedCount,
      removedCount,
      retainedCount,
    });
    return result;
  }

  private async isCandidateValid(candidate: NovelRebaseCandidate): Promise<boolean> {
    const source = await this.options.draftStore.getDraftSession(
      candidate.session.novelId,
      candidate.sourceDraftSessionId,
    );
    if (!matchesSource(candidate, source)) return false;
    if (!(await this.matchesSnapshot(candidate.session, candidate.sourceDraftSessionId))) {
      return false;
    }
    return this.matchesOperationSequence(
      candidate.session,
      candidate.operationCount,
      candidate.lastOperationSequence,
    );
  }

  private async isResolvedCandidateValid(
    candidate: NovelResolvedRebaseCandidate,
    candidates: readonly NovelRebaseCandidate[],
    candidateValidity: ReadonlyMap<string, boolean>,
  ): Promise<boolean> {
    const conflicted = candidates.find(
      (value) => value.session.id === candidate.conflictedCandidateDraftSessionId,
    );
    if (
      conflicted === undefined ||
      candidateValidity.get(conflicted.session.id) !== true ||
      candidate.sourceDraftSessionId !== conflicted.sourceDraftSessionId ||
      candidate.session.ownerConversationId !== conflicted.session.ownerConversationId ||
      candidate.session.baseRevision !== conflicted.session.baseRevision ||
      !(await this.matchesSnapshot(
        candidate.session,
        candidate.sourceDraftSessionId,
      )) ||
      !(await this.matchesOperationSequence(
        candidate.session,
        candidate.operationCount,
        candidate.lastOperationSequence,
      ))
    ) {
      return false;
    }
    try {
      const plan = await this.options.resolutionPlanStore.getPlan(
        conflicted.session,
      );
      return (
        plan !== undefined &&
        plan.digest === candidate.resolutionPlanDigest &&
        plan.sourceDraftSessionId === candidate.sourceDraftSessionId &&
        plan.conflictedCandidateDraftSessionId ===
          candidate.conflictedCandidateDraftSessionId &&
        plan.baseRevision === candidate.session.baseRevision &&
        plan.effectiveOperationCount === candidate.operationCount
      );
    } catch {
      return false;
    }
  }

  private async matchesSnapshot(
    session: NovelDraftSession,
    sourceDraftSessionId: NovelRebaseCandidate["sourceDraftSessionId"],
  ): Promise<boolean> {
    try {
      const snapshot = await this.options.snapshotter.inspectDraftSnapshot(
        session.novelId,
        session.id,
      );
      return (
        snapshot !== undefined &&
        snapshot.kind === "rebase-candidate" &&
        snapshot.draftSessionId === session.id &&
        snapshot.novelId === session.novelId &&
        snapshot.ownerConversationId === session.ownerConversationId &&
        snapshot.baseRevision === session.baseRevision &&
        snapshot.sourceDraftSessionId === sourceDraftSessionId
      );
    } catch {
      return false;
    }
  }

  private async matchesOperationSequence(
    session: NovelDraftSession,
    operationCount: number,
    lastOperationSequence: number,
  ): Promise<boolean> {
    try {
      const sequence = await this.options.operationStore.readOperationSequence(
        session,
      );
      return (
        sequence.operationCount === operationCount &&
        sequence.lastOperationSequence === lastOperationSequence &&
        sequence.operations.length === operationCount
      );
    } catch {
      return false;
    }
  }

  private async removeCandidate(candidate: NovelRebaseCandidate): Promise<void> {
    await this.options.snapshotter.removeDraftSnapshot(
      candidate.session.novelId,
      candidate.session.id,
    );
    await this.options.candidateStore.removeCandidate(
      candidate.session.novelId,
      candidate.session.id,
    );
  }

  private async removeResolvedCandidate(
    candidate: NovelResolvedRebaseCandidate,
  ): Promise<void> {
    await this.options.snapshotter.removeDraftSnapshot(
      candidate.session.novelId,
      candidate.session.id,
    );
    await this.options.resolvedCandidateStore.removeResolvedCandidate(
      candidate.session.novelId,
      candidate.session.id,
    );
  }
}

function matchesSource(
  candidate: NovelRebaseCandidate,
  source: NovelDraftSession | undefined,
): boolean {
  return (
    source !== undefined &&
    !isTerminalNovelDraftStatus(source.status) &&
    source.ownerConversationId === candidate.session.ownerConversationId &&
    source.baseRevision === candidate.sourceBaseRevision
  );
}
