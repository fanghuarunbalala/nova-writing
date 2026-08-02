/** Serializes canonical Commits per Novel and coordinates payload plus SQLite authority. */
import { noopLogger, type Logger } from "../../observability/index.js";
import { NovelCommitHistoryIntegrityError } from "../error/index.js";
import type { NovelApprovalService } from "../approval/index.js";
import type { NovelId } from "../identity/index.js";
import type { NovelOperationExecutor } from "../operation/index.js";
import type { NovelCommitHistoryStore, NovelCommitStore } from "../port/index.js";
import { captureNovelChangeSet, type NovelChangeSet } from "./NovelChangeSet.js";
import { captureNovelCommit, type NovelCommit } from "./NovelCommit.js";
import { captureNovelCommitPayload, type NovelCommitPayload } from "./NovelCommitPayload.js";

export interface NovelCommitWriterOptions<TContext> {
  readonly store: NovelCommitStore<TContext>;
  readonly history: NovelCommitHistoryStore;
  readonly executor: NovelOperationExecutor<TContext>;
  readonly validate?: (context: TContext) => void;
  readonly approvalVerifier?: Pick<NovelApprovalService, "verify">;
  readonly logger?: Logger;
}

export interface WriteNovelCommitInput {
  readonly changeSet: NovelChangeSet;
  readonly payload: NovelCommitPayload;
}

export interface NovelCommitWriteResult {
  readonly status: "committed" | "duplicate";
  readonly commit: NovelCommit;
}

export class NovelCommitWriter<TContext> {
  private readonly serializer = new NovelCommitSerializer();
  private readonly logger: Logger;

  constructor(private readonly options: NovelCommitWriterOptions<TContext>) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_commit_writer",
    });
  }

  write(input: WriteNovelCommitInput): Promise<NovelCommitWriteResult> {
    const changeSet = captureNovelChangeSet(input.changeSet);
    const payload = captureNovelCommitPayload(input.payload);
    assertPayloadMatchesChangeSet(payload, changeSet);
    return this.runExclusive(changeSet.novelId, async () => {
      await this.options.approvalVerifier?.verify(changeSet);
      const references = await this.options.store.listHistoryReferences();
      const reconciliation = await this.options.history.reconcile(references);
      if (reconciliation.missing.length > 0) {
        throw new NovelCommitHistoryIntegrityError(
          reconciliation.missing[0].commitId,
        );
      }
      const prepared = await this.options.history.prepare(payload);
      await this.options.history.verify(prepared);
      const commit = captureNovelCommit({
        commitId: payload.commitId,
        novelId: payload.novelId,
        draftSessionId: payload.draftSessionId,
        ownerConversationId: payload.ownerConversationId,
        baseRevision: payload.baseRevision,
        resultRevision: payload.resultRevision,
        changeSetDigest: payload.changeSetDigest,
        payloadRef: prepared.payloadRef,
        payloadDigest: prepared.payloadDigest,
        payloadSize: prepared.payloadSize,
        committedAt: payload.committedAt,
      });
      this.logger.info("novel_commit.write.started", {
        novelId: commit.novelId,
        draftSessionId: commit.draftSessionId,
        commitId: commit.commitId,
      });
      const status = await this.options.store.commit({
        commit,
        changeSet,
        apply: (context) => {
          for (const entry of changeSet.operations) {
            this.options.executor.executeSynchronous(context, entry.operation);
          }
        },
        validate: this.options.validate ?? (() => undefined),
      });
      this.logger.info("novel_commit.write.completed", {
        novelId: commit.novelId,
        draftSessionId: commit.draftSessionId,
        commitId: commit.commitId,
        status,
        resultRevision: commit.resultRevision,
      });
      return Object.freeze({ status, commit });
    });
  }

  runExclusive<T>(novelId: NovelId, operation: () => Promise<T>): Promise<T> {
    return this.serializer.run(novelId, operation);
  }
}

function assertPayloadMatchesChangeSet(
  payload: NovelCommitPayload,
  changeSet: NovelChangeSet,
): void {
  if (
    payload.novelId !== changeSet.novelId ||
    payload.draftSessionId !== changeSet.draftSessionId ||
    payload.baseRevision !== changeSet.baseRevision ||
    payload.changeSetDigest !== changeSet.digest ||
    payload.operationCount !== changeSet.operationCount ||
    payload.operations.some((entry, index) =>
      entry.sequence !== changeSet.operations[index]?.sequence ||
      entry.operationDigest !== changeSet.operations[index]?.operationDigest ||
      entry.operation.operationId !== changeSet.operations[index]?.operation.operationId)
  ) {
    throw new TypeError("Novel Commit payload does not match ChangeSet");
  }
}

class NovelCommitSerializer {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(novelId: NovelId, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(novelId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(novelId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(novelId) === tail) this.tails.delete(novelId);
    }
  }
}
