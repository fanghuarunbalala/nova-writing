/** Prepares a durable sibling Draft by replaying source Operations in order. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  NOVEL_DRAFT_SESSION_STATUS,
  captureNovelDraftSession,
  type NovelDraftSession,
} from "../draft/index.js";
import {
  NovelDraftSessionNotFoundError,
  NovelDraftSessionStateError,
  NovelInvariantViolationError,
  NovelRebaseNotRequiredError,
  NOVEL_INVARIANT_FAILURE,
} from "../error/index.js";
import type {
  NovelDraftSessionId,
  NovelIdentityFactory,
} from "../identity/index.js";
import type {
  NovelOperationDigester,
  NovelOperationExecutor,
  NovelDraftOperationWriter,
} from "../operation/index.js";
import type {
  NovelCanonicalStore,
  NovelClock,
  NovelDraftChangeSetStore,
  NovelDraftOperationStore,
  NovelDraftStore,
  NovelRebaseCandidateStore,
  NovelSnapshotter,
} from "../port/index.js";
import {
  captureNovelRebaseCandidate,
  type NovelRebaseCandidate,
} from "./NovelRebaseCandidate.js";

export interface NovelRebaseServiceOptions<TContext> {
  readonly canonicalStore: NovelCanonicalStore;
  readonly draftStore: NovelDraftStore;
  readonly snapshotter: NovelSnapshotter;
  readonly candidateStore: NovelRebaseCandidateStore;
  readonly operationStore: NovelDraftOperationStore<TContext> &
    NovelDraftChangeSetStore;
  readonly writer: Pick<NovelDraftOperationWriter<unknown>, "runExclusive">;
  readonly executor: NovelOperationExecutor<TContext>;
  readonly operationDigester: NovelOperationDigester;
  readonly identityFactory: Pick<NovelIdentityFactory, "createDraftSessionId">;
  readonly clock: NovelClock;
  readonly logger?: Logger;
}

export class NovelRebaseService<TContext> {
  private readonly logger: Logger;

  constructor(private readonly options: NovelRebaseServiceOptions<TContext>) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_rebase_service",
    });
  }

  async prepareCandidate(
    sourceDraftSessionId: NovelDraftSessionId,
  ): Promise<NovelRebaseCandidate> {
    const metadata = await this.options.canonicalStore.getMetadata();
    const initialSource = await this.options.draftStore.getDraftSession(
      metadata.novelId,
      sourceDraftSessionId,
    );
    if (initialSource === undefined) {
      throw new NovelDraftSessionNotFoundError(sourceDraftSessionId);
    }
    if (initialSource.status !== NOVEL_DRAFT_SESSION_STATUS.active) {
      throw new NovelDraftSessionStateError(
        initialSource.id,
        [NOVEL_DRAFT_SESSION_STATUS.active],
        initialSource.status,
      );
    }

    return this.options.writer.runExclusive(initialSource, async () => {
      const source = await this.options.draftStore.getDraftSession(
        initialSource.novelId,
        initialSource.id,
      );
      if (source === undefined) {
        throw new NovelDraftSessionNotFoundError(initialSource.id);
      }
      if (source.status !== NOVEL_DRAFT_SESSION_STATUS.active) {
        throw new NovelDraftSessionStateError(
          source.id,
          [NOVEL_DRAFT_SESSION_STATUS.active],
          source.status,
        );
      }
      const latest = await this.options.canonicalStore.getMetadata();
      if (latest.currentRevision === source.baseRevision) {
        throw new NovelRebaseNotRequiredError(
          source.novelId,
          source.id,
          source.baseRevision,
        );
      }
      const preparedAt = this.options.clock.now();
      const candidateSession = captureNovelDraftSession({
        id: this.options.identityFactory.createDraftSessionId(),
        novelId: source.novelId,
        ownerConversationId: source.ownerConversationId,
        baseRevision: latest.currentRevision,
        status: NOVEL_DRAFT_SESSION_STATUS.rebasing,
        createdAt: preparedAt,
        updatedAt: preparedAt,
      });
      this.logger.info("novel_rebase_candidate.prepare.started", {
        novelId: source.novelId,
        sourceDraftSessionId: source.id,
        candidateDraftSessionId: candidateSession.id,
      });

      let registered = false;
      try {
        const sourceSequence =
          await this.options.operationStore.readOperationSequence(source);
        await this.verifySourceOperations(source, sourceSequence.operations);
        await this.options.snapshotter.createRebaseCandidateSnapshot({
          session: candidateSession,
          sourceDraftSessionId: source.id,
        });

        for (const entry of sourceSequence.operations) {
          const receipt = await this.options.operationStore.appendOperation({
            session: candidateSession,
            operation: entry.operation,
            digest: entry.operationDigest,
            recordedAt: this.options.clock.now(),
            apply: (context) =>
              this.options.executor.executeSynchronous(
                context,
                entry.operation,
              ),
          });
          if (
            receipt.status !== "appended" ||
            receipt.sequence !== entry.sequence ||
            receipt.digest !== entry.operationDigest
          ) {
            throw corrupt(source);
          }
        }

        const replayed =
          await this.options.operationStore.readOperationSequence(
            candidateSession,
          );
        assertReplayMatches(source, sourceSequence, replayed);
        const candidate = captureNovelRebaseCandidate({
          sourceDraftSessionId: source.id,
          sourceBaseRevision: source.baseRevision,
          session: candidateSession,
          operationCount: replayed.operationCount,
          lastOperationSequence: replayed.lastOperationSequence,
          preparedAt,
        });
        await this.options.candidateStore.createCandidate(candidate);
        registered = true;
        this.logger.info("novel_rebase_candidate.prepare.completed", {
          novelId: source.novelId,
          sourceDraftSessionId: source.id,
          candidateDraftSessionId: candidateSession.id,
          operationCount: candidate.operationCount,
        });
        return candidate;
      } catch (error) {
        this.logger.info("novel_rebase_candidate.prepare.failed", {
          novelId: source.novelId,
          sourceDraftSessionId: source.id,
          candidateDraftSessionId: candidateSession.id,
        });
        if (!registered) {
          await this.options.snapshotter
            .removeDraftSnapshot(source.novelId, candidateSession.id)
            .catch(() => undefined);
        }
        throw error;
      }
    });
  }

  private async verifySourceOperations(
    source: NovelDraftSession,
    operations: Awaited<
      ReturnType<NovelDraftChangeSetStore["readOperationSequence"]>
    >["operations"],
  ): Promise<void> {
    for (const entry of operations) {
      if (
        (await this.options.operationDigester.digest(entry.operation)) !==
        entry.operationDigest
      ) {
        throw corrupt(source);
      }
    }
  }
}

function assertReplayMatches(
  source: NovelDraftSession,
  expected: Awaited<
    ReturnType<NovelDraftChangeSetStore["readOperationSequence"]>
  >,
  actual: Awaited<
    ReturnType<NovelDraftChangeSetStore["readOperationSequence"]>
  >,
): void {
  if (
    actual.operationCount !== expected.operationCount ||
    actual.lastOperationSequence !== expected.lastOperationSequence ||
    actual.frozen !== undefined ||
    actual.operations.some((entry, index) => {
      const sourceEntry = expected.operations[index];
      return (
        sourceEntry === undefined ||
        entry.sequence !== sourceEntry.sequence ||
        entry.operationDigest !== sourceEntry.operationDigest ||
        entry.operation.operationId !== sourceEntry.operation.operationId
      );
    })
  ) {
    throw corrupt(source);
  }
}

function corrupt(session: NovelDraftSession): NovelInvariantViolationError {
  return new NovelInvariantViolationError(
    NOVEL_INVARIANT_FAILURE.persistenceInvariant,
    session.novelId,
    session.id,
  );
}
