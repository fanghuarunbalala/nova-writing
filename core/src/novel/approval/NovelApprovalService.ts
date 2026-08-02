/** Grants, invalidates, and verifies exact ChangeSet-bound Novel Approval. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { NovelChangeSet } from "../commit/index.js";
import { NovelApprovalRequiredError } from "../error/index.js";
import type { NovelDraftSession } from "../draft/index.js";
import type { NovelApprovalStore, NovelClock } from "../port/index.js";
import { NOVEL_CHANGE_SET_APPROVAL_VERSION, approvalMatchesChangeSet, captureNovelChangeSetApproval, captureNovelChangeSetApprovalContent, type NovelApprovalDigester, type NovelApprovalInvalidationReason, type NovelChangeSetApproval } from "./NovelChangeSetApproval.js";

export interface NovelApprovalServiceOptions {
  readonly store: NovelApprovalStore;
  readonly digester: NovelApprovalDigester;
  readonly clock: NovelClock;
  readonly logger?: Logger;
}
export class NovelApprovalService {
  private readonly logger: Logger;
  constructor(private readonly options: NovelApprovalServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({ component: "novel_approval_service" });
  }
  async grant(changeSet: NovelChangeSet): Promise<{ readonly status: "recorded" | "duplicate"; readonly approval: NovelChangeSetApproval }> {
    const existing = await this.options.store.getActiveApproval(
      changeSet.draftSessionId,
    );
    if (existing !== undefined && approvalMatchesChangeSet(existing, changeSet)) {
      return Object.freeze({ status: "duplicate", approval: existing });
    }
    const content = captureNovelChangeSetApprovalContent({
      approvalVersion: NOVEL_CHANGE_SET_APPROVAL_VERSION,
      draftSessionId: changeSet.draftSessionId,
      baseRevision: changeSet.baseRevision,
      changeSetDigest: changeSet.digest,
      operationIds: changeSet.operations.map((entry) => entry.operation.operationId),
      grantedAt: this.options.clock.now(),
    });
    const approval = captureNovelChangeSetApproval({ ...content, digest: await this.options.digester.digest(content) });
    const status = await this.options.store.grantApproval(approval);
    this.logger.info("novel_approval.granted", { draftSessionId: approval.draftSessionId, operationCount: approval.operationIds.length, status });
    return Object.freeze({ status, approval });
  }
  async invalidate(session: NovelDraftSession, reason: NovelApprovalInvalidationReason): Promise<"invalidated" | "absent"> {
    const status = await this.options.store.invalidateApproval(session, reason, this.options.clock.now());
    this.logger.info("novel_approval.invalidated", { draftSessionId: session.id, reason, status });
    return status;
  }
  async verify(changeSet: NovelChangeSet): Promise<void> {
    const approval = await this.options.store.getActiveApproval(changeSet.draftSessionId);
    if (approval === undefined || !approvalMatchesChangeSet(approval, changeSet)) {
      throw new NovelApprovalRequiredError(changeSet.draftSessionId);
    }
  }
}
