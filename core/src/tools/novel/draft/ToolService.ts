/**
 * Provider-neutral Novel Draft lifecycle tool semantics: inspect the active
 * Draft, commit it to canonical state, roll it back, or rebase it onto the
 * latest canonical revision. Approval-gated commit failures surface as
 * rejected(approval_required); rebase conflicts are reported as summaries
 * whose resolution stays in the host.
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  NovelApprovalRequiredError,
  NovelCommitService,
  NovelDraftChangeSetBuilder,
  NovelDraftSessionService,
  NovelRebaseNotRequiredError,
  type NovelConflictRecord,
  type NovelDraftSession,
  type NovelRebasePreparationResult,
} from "../../../novel/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import type {
  NovelConflictSummary,
  NovelDraftCommitArguments,
  NovelDraftCommitDetails,
  NovelDraftRebaseArguments,
  NovelDraftRebaseDetails,
  NovelDraftRollbackArguments,
  NovelDraftRollbackDetails,
  NovelDraftStatusArguments,
  NovelDraftStatusDetails,
} from "./schemas.js";

export interface NovelDraftToolServiceOptions {
  readonly drafts: NovelDraftSessionService;
  readonly commits: NovelCommitService<never>;
  readonly changeSets: NovelDraftChangeSetBuilder;
  readonly prepareRebase: (
    session: NovelDraftSession,
  ) => Promise<NovelRebasePreparationResult>;
  readonly logger?: Logger;
}

export class NovelDraftToolService {
  private readonly logger: Logger;

  constructor(private readonly options: NovelDraftToolServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_draft_tool_service",
    });
  }

  async status(
    conversationId: string,
    _arguments_: NovelDraftStatusArguments,
  ): Promise<NovelDraftStatusDetails> {
    const session = await this.options.drafts.getActiveDraft(conversationId);
    if (session === undefined) {
      return {};
    }
    return {
      draft: {
        id: session.id,
        status: session.status,
        baseRevision: session.baseRevision,
        updatedAt: session.updatedAt,
      },
    };
  }

  async commit(
    conversationId: string,
    _arguments_: NovelDraftCommitArguments,
  ): Promise<NovelDraftCommitDetails> {
    const session = await this.requireActiveDraft(conversationId);
    const changeSet = await this.options.changeSets.build(session);
    try {
      const result = await this.options.commits.commit(session);
      return Object.freeze({
        status: result.status,
        commitId: result.commit.commitId,
        resultRevision: result.commit.resultRevision,
        operationCount: changeSet.operationCount,
        committedAt: result.commit.committedAt,
      });
    } catch (error) {
      if (error instanceof NovelApprovalRequiredError) {
        return Object.freeze({ status: "rejected", reason: "approval_required" });
      }
      throw error;
    }
  }

  async rollback(
    conversationId: string,
    _arguments_: NovelDraftRollbackArguments,
  ): Promise<NovelDraftRollbackDetails> {
    const session = await this.requireActiveDraft(conversationId);
    const rolledBack = await this.options.drafts.rollback(session.id);
    return Object.freeze({
      status: "rolled-back",
      draftId: rolledBack.id,
      ...(rolledBack.terminalAt === undefined
        ? {}
        : { rolledBackAt: rolledBack.terminalAt }),
    });
  }

  async rebase(
    conversationId: string,
    _arguments_: NovelDraftRebaseArguments,
  ): Promise<NovelDraftRebaseDetails> {
    const session = await this.requireActiveDraft(conversationId);
    try {
      const result = await this.options.prepareRebase(session);
      if (result.conflicts.length === 0) {
        return Object.freeze({
          status: "rebased",
          baseRevision: result.candidate.session.baseRevision,
        });
      }
      return Object.freeze({
        status: "conflicted",
        baseRevision: result.candidate.session.baseRevision,
        conflictCount: result.conflicts.length,
        conflicts: result.conflicts.map(toConflictSummary),
      });
    } catch (error) {
      if (error instanceof NovelRebaseNotRequiredError) {
        return Object.freeze({ status: "not_required" });
      }
      throw error;
    }
  }

  private async requireActiveDraft(
    conversationId: string,
  ): Promise<NovelDraftSession> {
    const session = await this.options.drafts.getActiveDraft(conversationId);
    if (session === undefined) {
      throw new ToolError({
        code: "NOVEL_DRAFT_NOT_ACTIVE",
        category: "execution",
        retryable: false,
        sideEffectStatus: "none",
        conversationId,
      });
    }
    return session;
  }
}

function toConflictSummary(
  record: NovelConflictRecord,
): NovelConflictSummary {
  return Object.freeze({
    kind: record.conflict.kind,
    entityType: record.conflict.entityType,
    entityId: record.conflict.entityId,
    ...(record.conflict.fieldPath === undefined
      ? {}
      : { fieldPath: record.conflict.fieldPath }),
  });
}
