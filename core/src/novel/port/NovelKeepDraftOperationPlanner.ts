/** Converts keep-draft intent into one validated replacement Operation or no-op. */
import type { NovelConflictRecord, NovelRebaseCandidate } from "../conflict/index.js";
import type { NovelDraftSession } from "../draft/index.js";
import type { NovelOperation } from "../operation/index.js";
import type { NovelChangeSetOperation } from "../commit/index.js";

export interface NovelKeepDraftOperationPlanningInput {
  readonly sourceSession: NovelDraftSession;
  readonly candidate: NovelRebaseCandidate;
  readonly sourceEntry: NovelChangeSetOperation;
  readonly conflict: NovelConflictRecord;
}

export type NovelKeepDraftOperationPlanningResult =
  | { readonly action: "apply-replacement"; readonly operation: NovelOperation }
  | { readonly action: "skip" };

export interface NovelKeepDraftOperationPlanner {
  planKeepDraft(
    input: NovelKeepDraftOperationPlanningInput,
  ): Promise<NovelKeepDraftOperationPlanningResult>;
}
