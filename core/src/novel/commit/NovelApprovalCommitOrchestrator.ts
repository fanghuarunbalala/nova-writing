/** Waits for exact ChangeSet Approval before invoking the short Commit service. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { NovelApprovalResolution } from "../approval/index.js";
import { captureNovelDraftSession, type NovelDraftSession } from "../draft/index.js";
import type { NovelClock } from "../port/index.js";
import type { NovelCommitId } from "../identity/index.js";
import type { NovelRevision, NovelTimestamp } from "../version/index.js";
import type { NovelChangeSet } from "./NovelChangeSet.js";
import type { NovelCommitService } from "./NovelCommitService.js";
import type { NovelCommitWriteResult } from "./NovelCommitWriter.js";
import type { NovelDraftChangeSetBuilder } from "./NovelDraftChangeSetBuilder.js";

export interface NovelApprovalRequester {
  request(
    changeSet: NovelChangeSet,
    conversationId: string,
    requestedAt: NovelTimestamp,
  ): Promise<NovelApprovalResolution>;
}

export interface NovelApprovalCommitOrchestratorOptions<TContext> {
  readonly changeSets: NovelDraftChangeSetBuilder;
  readonly approvals: NovelApprovalRequester;
  readonly commits: NovelCommitService<TContext>;
  readonly clock: NovelClock;
  readonly logger?: Logger;
}

export type NovelApprovalCommitResult =
  | {
      readonly status: "committed";
      readonly approval: NovelApprovalResolution;
      readonly commit: NovelCommitWriteResult;
    }
  | {
      readonly status: "rejected" | "stale" | "stale-after-approval";
      readonly approval: NovelApprovalResolution;
    };

export class NovelApprovalCommitOrchestrator<TContext> {
  private readonly logger: Logger;

  constructor(
    private readonly options: NovelApprovalCommitOrchestratorOptions<TContext>,
  ) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_approval_commit_orchestrator",
    });
  }

  async commit(
    sessionInput: NovelDraftSession,
    options: {
      readonly commitId?: NovelCommitId;
      readonly resultRevision?: NovelRevision;
      readonly committedAt?: NovelTimestamp;
    } = {},
  ): Promise<NovelApprovalCommitResult> {
    const session = captureNovelDraftSession(sessionInput);
    const requestedChangeSet = await this.options.changeSets.build(session);
    this.logger.info("novel_approval_commit.waiting", {
      draftSessionId: session.id,
      operationCount: requestedChangeSet.operationCount,
    });
    const approval = await this.options.approvals.request(
      requestedChangeSet,
      session.ownerConversationId,
      this.options.clock.now(),
    );
    if (approval.decision === "rejected") {
      return Object.freeze({ status: "rejected", approval });
    }
    if (approval.decision === "stale") {
      return Object.freeze({ status: "stale", approval });
    }

    const currentChangeSet = await this.options.changeSets.build(session);
    if (!sameChangeSet(requestedChangeSet, currentChangeSet)) {
      this.logger.info("novel_approval_commit.stale_after_approval", {
        draftSessionId: session.id,
      });
      return Object.freeze({ status: "stale-after-approval", approval });
    }
    const commit = await this.options.commits.commit(session, options);
    this.logger.info("novel_approval_commit.completed", {
      draftSessionId: session.id,
      commitId: commit.commit.commitId,
      resultRevision: commit.commit.resultRevision,
    });
    return Object.freeze({ status: "committed", approval, commit });
  }
}

function sameChangeSet(left: NovelChangeSet, right: NovelChangeSet): boolean {
  return (
    left.novelId === right.novelId &&
    left.draftSessionId === right.draftSessionId &&
    left.baseRevision === right.baseRevision &&
    left.digest === right.digest &&
    left.operationCount === right.operationCount &&
    left.operations.every(
      (entry, index) =>
        entry.operation.operationId ===
        right.operations[index]?.operation.operationId,
    )
  );
}
