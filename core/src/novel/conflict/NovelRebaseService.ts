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
  NovelOperationPreconditionError,
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
  NovelConflictDigester,
  NovelConflictStore,
  NovelDraftChangeSetStore,
  NovelDraftOperationStore,
  NovelDraftStore,
  NovelRebaseCandidateStore,
  NovelSnapshotter,
} from "../port/index.js";
import {
  NOVEL_CONFLICT_VERSION,
  captureNovelConflict,
  captureNovelConflictRecord,
  type NovelConflict,
  type NovelConflictRecord,
} from "./NovelConflict.js";
import {
  captureNovelRebaseCandidate,
  type NovelRebasePreparationResult,
} from "./NovelRebaseCandidate.js";

export interface NovelRebaseServiceOptions<TContext> {
  readonly canonicalStore: NovelCanonicalStore;
  readonly draftStore: NovelDraftStore;
  readonly snapshotter: NovelSnapshotter;
  readonly candidateStore: NovelRebaseCandidateStore;
  readonly conflictStore: NovelConflictStore;
  readonly conflictDigester: NovelConflictDigester;
  readonly operationStore: NovelDraftOperationStore<TContext> &
    NovelDraftChangeSetStore;
  readonly writer: Pick<NovelDraftOperationWriter<unknown>, "runExclusive">;
  readonly executor: NovelOperationExecutor<TContext>;
  readonly operationDigester: NovelOperationDigester;
  readonly identityFactory: Pick<
    NovelIdentityFactory,
    "createDraftSessionId" | "createConflictId"
  >;
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
  ): Promise<NovelRebasePreparationResult> {
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

        const conflicts: NovelConflictRecord[] = [];
        const appliedEntries = [];
        for (const entry of sourceSequence.operations) {
          let receipt;
          try {
            receipt = await this.options.operationStore.appendOperation({
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
          } catch (error) {
            if (!(error instanceof NovelOperationPreconditionError)) {
              throw error;
            }
            const record = await this.createConflict(
              source,
              candidateSession,
              entry.sequence,
              entry.operation,
              error,
            );
            const status = await this.options.conflictStore.recordConflict(
              candidateSession,
              record,
            );
            if (status !== "recorded") throw corrupt(source);
            conflicts.push(record);
            continue;
          }
          appliedEntries.push(entry);
          if (
            receipt.status !== "appended" ||
            receipt.sequence !== appliedEntries.length ||
            receipt.digest !== entry.operationDigest
          ) {
            throw corrupt(source);
          }
        }

        const replayed =
          await this.options.operationStore.readOperationSequence(
            candidateSession,
          );
        assertReplayMatches(source, appliedEntries, replayed);
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
          conflictCount: conflicts.length,
        });
        return Object.freeze({
          candidate,
          conflicts: Object.freeze([...conflicts]),
        });
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

  private async createConflict(
    source: NovelDraftSession,
    candidate: NovelDraftSession,
    sourceOperationSequence: number,
    operation: Awaited<
      ReturnType<NovelDraftChangeSetStore["readOperationSequence"]>
    >["operations"][number]["operation"],
    error: NovelOperationPreconditionError,
  ): Promise<NovelConflictRecord> {
    const precondition = operation.expected.find(
      (value) =>
        value.entityType === error.entityType &&
        value.entityId === error.entityId,
    );
    if (precondition === undefined) throw corrupt(source);
    const conflict = captureNovelConflict({
      conflictVersion: NOVEL_CONFLICT_VERSION,
      id: this.options.identityFactory.createConflictId(),
      draftSessionId: candidate.id,
      operationId: operation.operationId,
      sourceOperationSequence,
      status: "unresolved",
      kind: conflictKind(error),
      entityType: error.entityType,
      entityId: error.entityId,
      ...(conflictFieldPath(error, precondition) === undefined
        ? {}
        : { fieldPath: conflictFieldPath(error, precondition) }),
      baseDigest:
        await this.options.conflictDigester.digestPrecondition(precondition),
      canonicalDigest:
        await this.options.conflictDigester.digestEntitySnapshot(
          candidate,
          error.entityType,
          error.entityId,
        ),
      draftDigest:
        await this.options.conflictDigester.digestEntitySnapshot(
          source,
          error.entityType,
          error.entityId,
        ),
      createdAt: this.options.clock.now(),
    });
    return captureNovelConflictRecord({
      conflict,
      digest: await this.options.conflictDigester.digestConflict(conflict),
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
  expected: readonly Awaited<
    ReturnType<NovelDraftChangeSetStore["readOperationSequence"]>
  >["operations"][number][],
  actual: Awaited<
    ReturnType<NovelDraftChangeSetStore["readOperationSequence"]>
  >,
): void {
  if (
    actual.operationCount !== expected.length ||
    actual.lastOperationSequence !== expected.length ||
    actual.frozen !== undefined ||
    actual.operations.some((entry, index) => {
      const sourceEntry = expected[index];
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

function conflictKind(
  error: NovelOperationPreconditionError,
): NovelConflict["kind"] {
  switch (error.failure) {
    case "entity_exists":
      return "entity-created";
    case "entity_missing":
      return "entity-deleted";
    case "entity_version_mismatch":
      return "field-modified";
    case "entity_referenced":
      return "domain-invariant";
  }
}

function conflictFieldPath(
  error: NovelOperationPreconditionError,
  precondition: { readonly kind: string; readonly fieldPath?: string },
): string | undefined {
  if (precondition.kind === "field-digest") return precondition.fieldPath;
  return error.failure === "entity_version_mismatch" ? "profile" : undefined;
}

function corrupt(session: NovelDraftSession): NovelInvariantViolationError {
  return new NovelInvariantViolationError(
    NOVEL_INVARIANT_FAILURE.persistenceInvariant,
    session.novelId,
    session.id,
  );
}
