/** Reconciles canonical Draft records and durable snapshots after restart. */
import {
  NOVEL_DRAFT_SESSION_STATUS,
  isTerminalNovelDraftStatus,
  type NovelDraftSession,
  type NovelDraftSessionStatus,
} from "./NovelDraftSession.js";
import {
  captureNovelDraftRecoveryResult,
  type NovelDraftRecoveryResult,
} from "./NovelDraftRecoveryResult.js";
import type {
  NovelCanonicalStore,
  NovelClock,
  NovelDraftStore,
  NovelRebaseCandidateStore,
  NovelResolvedRebaseCandidateStore,
  NovelSnapshotter,
  NovelLifecycleRecordWriter,
} from "../port/index.js";
import {
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
} from "../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";

const RECOVERABLE_DRAFT_STATUSES: readonly NovelDraftSessionStatus[] = [
  NOVEL_DRAFT_SESSION_STATUS.active,
  NOVEL_DRAFT_SESSION_STATUS.awaitingApproval,
  NOVEL_DRAFT_SESSION_STATUS.rebasing,
  NOVEL_DRAFT_SESSION_STATUS.conflicted,
  NOVEL_DRAFT_SESSION_STATUS.committing,
];

export interface NovelDraftRecoveryServiceOptions {
  readonly canonicalStore: NovelCanonicalStore;
  readonly draftStore: NovelDraftStore;
  readonly snapshotter: NovelSnapshotter;
  readonly rebaseCandidateStore?: NovelRebaseCandidateStore;
  readonly resolvedRebaseCandidateStore?: Pick<
    NovelResolvedRebaseCandidateStore,
    "listResolvedCandidates"
  >;
  readonly clock: NovelClock;
  readonly lifecycleWriter: NovelLifecycleRecordWriter;
  readonly logger?: Logger;
}

export class NovelDraftRecoveryService {
  private readonly logger: Logger;
  private recovery?: Promise<NovelDraftRecoveryResult>;

  constructor(private readonly options: NovelDraftRecoveryServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_draft_recovery_service",
    });
  }

  recoverDraftSessions(): Promise<NovelDraftRecoveryResult> {
    this.recovery ??= this.recoverOnce().finally(() => {
      this.recovery = undefined;
    });
    return this.recovery;
  }

  private async recoverOnce(): Promise<NovelDraftRecoveryResult> {
    const metadata = await this.options.canonicalStore.getMetadata();
    this.logger.info("novel_draft_recovery.started", {
      novelId: metadata.novelId,
    });
    const sessions = await this.options.draftStore.listDraftSessions(
      metadata.novelId,
    );
    const snapshotIds = await this.options.snapshotter.listDraftSnapshotIds(
      metadata.novelId,
    );
    const candidates =
      (await this.options.rebaseCandidateStore?.listCandidates(
        metadata.novelId,
      )) ?? [];
    const resolvedCandidates =
      (await this.options.resolvedRebaseCandidateStore?.listResolvedCandidates(
        metadata.novelId,
      )) ?? [];
    const knownSessionIds = new Set([
      ...sessions.map((session) => session.id),
      ...candidates.map((candidate) => candidate.session.id),
      ...resolvedCandidates.map((candidate) => candidate.session.id),
    ]);
    const recovered = [];
    const reset = [];
    const rolledBack = [];
    const retainedTerminal = [];
    const removedCandidates = [];
    const removedOrphans = [];

    for (const session of sessions) {
      if (isTerminalNovelDraftStatus(session.status)) {
        if (snapshotIds.includes(session.id)) {
          retainedTerminal.push(session.id);
        }
        continue;
      }

      const snapshot = await this.options.snapshotter
        .inspectDraftSnapshot(session.novelId, session.id)
        .catch(() => undefined);
      if (
        snapshot === undefined ||
        snapshot.ownerConversationId !== session.ownerConversationId
      ) {
        await this.rollbackBrokenSession(session);
        rolledBack.push(session.id);
        continue;
      }

      if (
        snapshot.baseRevision !== session.baseRevision &&
        session.status === NOVEL_DRAFT_SESSION_STATUS.active &&
        snapshot.replacedBaseRevision === session.baseRevision
      ) {
        await this.options.draftStore.resetDraftSession({
          novelId: session.novelId,
          draftSessionId: session.id,
          expectedBaseRevision: session.baseRevision,
          expectedStatuses: [NOVEL_DRAFT_SESSION_STATUS.active],
          baseRevision: snapshot.baseRevision,
          resetAt: this.options.clock.now(),
        });
        reset.push(session.id);
      } else if (snapshot.baseRevision !== session.baseRevision) {
        await this.rollbackBrokenSession(session);
        rolledBack.push(session.id);
        continue;
      }
      recovered.push(session.id);
    }

    for (const candidate of candidates) {
      const snapshot = await this.options.snapshotter
        .inspectDraftSnapshot(candidate.session.novelId, candidate.session.id)
        .catch(() => undefined);
      if (
        snapshot?.kind === "rebase-candidate" &&
        snapshot.sourceDraftSessionId === candidate.sourceDraftSessionId &&
        snapshot.ownerConversationId ===
          candidate.session.ownerConversationId &&
        snapshot.baseRevision === candidate.session.baseRevision
      ) {
        continue;
      }
      await this.options.rebaseCandidateStore?.removeCandidate(
        candidate.session.novelId,
        candidate.session.id,
      );
      await this.options.snapshotter.removeDraftSnapshot(
        candidate.session.novelId,
        candidate.session.id,
      );
      removedCandidates.push(candidate.session.id);
    }

    for (const snapshotId of snapshotIds) {
      if (knownSessionIds.has(snapshotId)) continue;
      const snapshot = await this.options.snapshotter
        .inspectDraftSnapshot(metadata.novelId, snapshotId)
        .catch(() => undefined);
      if (
        snapshot?.kind === "rebase-candidate" &&
        this.options.rebaseCandidateStore === undefined
      ) {
        continue;
      }
      await this.options.snapshotter.removeDraftSnapshot(
        metadata.novelId,
        snapshotId,
      );
      removedOrphans.push(snapshotId);
    }

    const result = captureNovelDraftRecoveryResult({
      recoveredDraftSessionIds: recovered,
      resetDraftSessionIds: reset,
      rolledBackDraftSessionIds: rolledBack,
      retainedTerminalSnapshotIds: retainedTerminal,
      removedCandidateSnapshotIds: removedCandidates,
      removedOrphanSnapshotIds: removedOrphans,
    });
    for (const draftSessionId of result.recoveredDraftSessionIds) {
      const session = sessions.find((value) => value.id === draftSessionId);
      if (session === undefined) continue;
      await this.options.lifecycleWriter.recordCanonical({
        recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
        eventId: `draft-recovery:${session.id}`,
        eventType: NOVEL_LIFECYCLE_EVENT_TYPE.recoveryCompleted,
        novelId: session.novelId,
        conversationId: session.ownerConversationId,
        occurredAt: session.createdAt,
        payload: {
          scope: "draft",
          outcome: "verified",
          affectedCount: 1,
        },
      });
    }
    this.logger.info("novel_draft_recovery.completed", {
      novelId: metadata.novelId,
      recoveredCount: result.recoveredDraftSessionIds.length,
      resetCount: result.resetDraftSessionIds.length,
      rolledBackCount: result.rolledBackDraftSessionIds.length,
      retainedTerminalCount: result.retainedTerminalSnapshotIds.length,
      removedCandidateCount: result.removedCandidateSnapshotIds.length,
      removedOrphanCount: result.removedOrphanSnapshotIds.length,
    });
    return result;
  }

  private async rollbackBrokenSession(session: NovelDraftSession): Promise<void> {
    await this.options.draftStore.rollbackDraftSession({
      novelId: session.novelId,
      draftSessionId: session.id,
      expectedStatuses: RECOVERABLE_DRAFT_STATUSES,
      rolledBackAt: this.options.clock.now(),
    });
    await this.options.snapshotter.removeDraftSnapshot(
      session.novelId,
      session.id,
    );
  }
}
