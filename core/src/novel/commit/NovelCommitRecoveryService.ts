/** Reconciles Commit history and regenerates missing payloads from frozen Drafts. */
import { noopLogger, type Logger } from "../../observability/index.js";
import { NOVEL_DRAFT_SESSION_STATUS, captureNovelDraftSession } from "../draft/index.js";
import { NovelCommitHistoryIntegrityError } from "../error/index.js";
import { captureNovelId, type NovelId } from "../identity/index.js";
import type { NovelOperationDigester, NovelDraftOperationWriter } from "../operation/index.js";
import type { NovelCommitHistoryStore, NovelCommitStore, NovelDraftChangeSetStore } from "../port/index.js";
import type { NovelLifecycleRecordWriter } from "../port/index.js";
import { NOVEL_LIFECYCLE_EVENT_TYPE, NOVEL_LIFECYCLE_RECORD_VERSION } from "../event/index.js";
import { NOVEL_CHANGE_SET_VERSION, captureNovelChangeSetIdentity } from "./NovelChangeSet.js";
import type { NovelChangeSetDigester } from "./NovelChangeSetDigest.js";
import { NOVEL_COMMIT_PAYLOAD_VERSION } from "./NovelCommitPayload.js";
import type { NovelCommitWriter } from "./NovelCommitWriter.js";

export interface NovelCommitRecoveryServiceOptions<TContext> {
  readonly writer: Pick<NovelCommitWriter<TContext>, "runExclusive">;
  readonly commitStore: NovelCommitStore<TContext>;
  readonly history: NovelCommitHistoryStore;
  readonly draftStore: NovelDraftChangeSetStore;
  readonly operationDigester: NovelOperationDigester;
  readonly changeSetDigester: NovelChangeSetDigester;
  readonly lifecycleWriter: NovelLifecycleRecordWriter;
  readonly logger?: Logger;
}

export interface NovelCommitRecoveryResult {
  readonly recoveredCount: number;
  readonly removedTemporaryCount: number;
  readonly removedOrphanCount: number;
}

export class NovelCommitRecoveryService<TContext> {
  private readonly logger: Logger;

  constructor(private readonly options: NovelCommitRecoveryServiceOptions<TContext>) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_commit_recovery_service",
    });
  }

  recover(novelIdInput: NovelId): Promise<NovelCommitRecoveryResult> {
    const novelId = captureNovelId(novelIdInput);
    return this.options.writer.runExclusive(novelId, async () => {
      const commits = await this.options.commitStore.listCommits();
      const reconciliation = await this.options.history.reconcile(commits);
      let recoveredCount = 0;
      for (const missing of reconciliation.missing) {
        const commit = commits.find((value) => value.commitId === missing.commitId);
        if (commit === undefined) throw new NovelCommitHistoryIntegrityError(missing.commitId);
        try {
          const session = captureNovelDraftSession({
            id: commit.draftSessionId,
            novelId: commit.novelId,
            ownerConversationId: commit.ownerConversationId,
            baseRevision: commit.baseRevision,
            status: NOVEL_DRAFT_SESSION_STATUS.committed,
            createdAt: commit.committedAt,
            updatedAt: commit.committedAt,
            terminalAt: commit.committedAt,
          });
          const source = await this.options.draftStore.readOperationSequence(session);
          for (const entry of source.operations) {
            if (
              await this.options.operationDigester.digest(entry.operation) !==
              entry.operationDigest
            ) throw new Error();
          }
          const identity = captureNovelChangeSetIdentity({
            changeSetVersion: NOVEL_CHANGE_SET_VERSION,
            novelId: commit.novelId,
            baseRevision: commit.baseRevision,
            operationCount: source.operationCount,
            lastOperationSequence: source.lastOperationSequence,
            operations: source.operations,
          });
          const digest = await this.options.changeSetDigester.digest(identity);
          if (digest !== commit.changeSetDigest || source.frozen?.digest !== digest) {
            throw new Error();
          }
          const prepared = await this.options.history.prepare({
            payloadVersion: NOVEL_COMMIT_PAYLOAD_VERSION,
            commitId: commit.commitId,
            novelId: commit.novelId,
            draftSessionId: commit.draftSessionId,
            ownerConversationId: commit.ownerConversationId,
            baseRevision: commit.baseRevision,
            resultRevision: commit.resultRevision,
            changeSetDigest: commit.changeSetDigest,
            operationCount: source.operationCount,
            committedAt: commit.committedAt,
            operations: source.operations,
          });
          if (
            prepared.payloadRef !== commit.payloadRef ||
            prepared.payloadDigest !== commit.payloadDigest ||
            prepared.payloadSize !== commit.payloadSize
          ) throw new Error();
          recoveredCount += 1;
          await this.options.lifecycleWriter.recordCanonical({
            recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
            eventId: `commit-recovered:${commit.commitId}`,
            eventType: NOVEL_LIFECYCLE_EVENT_TYPE.commitRecovered,
            novelId: commit.novelId,
            conversationId: commit.ownerConversationId,
            occurredAt: commit.committedAt,
            payload: {
              draftSessionId: commit.draftSessionId,
              commitId: commit.commitId,
              resultRevision: commit.resultRevision,
              recovery: "payload-regenerated",
            },
          });
        } catch {
          throw new NovelCommitHistoryIntegrityError(commit.commitId);
        }
      }
      this.logger.info("novel_commit_recovery.completed", {
        novelId,
        commitCount: commits.length,
        recoveredCount,
        removedTemporaryCount: reconciliation.removedTemporaryCount,
        removedOrphanCount: reconciliation.removedOrphanCount,
      });
      return Object.freeze({
        recoveredCount,
        removedTemporaryCount: reconciliation.removedTemporaryCount,
        removedOrphanCount: reconciliation.removedOrphanCount,
      });
    });
  }
}
