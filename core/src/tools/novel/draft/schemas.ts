/** Shared TypeBox schemas and JSON contracts for Novel Draft lifecycle tools. */
import { Type, type Static } from "typebox";

export const NovelDraftStatusParametersSchema = Type.Object(
  {},
  { additionalProperties: false },
);
export type NovelDraftStatusArguments = Static<
  typeof NovelDraftStatusParametersSchema
>;

export const NovelDraftCommitParametersSchema = Type.Object(
  {},
  { additionalProperties: false },
);
export type NovelDraftCommitArguments = Static<
  typeof NovelDraftCommitParametersSchema
>;

export const NovelDraftRollbackParametersSchema = Type.Object(
  {},
  { additionalProperties: false },
);
export type NovelDraftRollbackArguments = Static<
  typeof NovelDraftRollbackParametersSchema
>;

export const NovelDraftRebaseParametersSchema = Type.Object(
  {},
  { additionalProperties: false },
);
export type NovelDraftRebaseArguments = Static<
  typeof NovelDraftRebaseParametersSchema
>;

export type NovelDraftStatusDetails = {
  readonly draft?: {
    readonly id: string;
    readonly status: string;
    readonly baseRevision: string;
    readonly updatedAt: string;
  };
};

export type NovelDraftCommitDetails = {
  readonly status: "committed" | "duplicate" | "rejected";
  readonly commitId?: string;
  readonly resultRevision?: string;
  readonly operationCount?: number;
  readonly committedAt?: string;
  readonly reason?: string;
};

export type NovelDraftRollbackDetails = {
  readonly status: "rolled-back" | "rejected";
  readonly draftId?: string;
  readonly rolledBackAt?: string;
  readonly reason?: string;
};

export type NovelConflictSummary = {
  readonly kind: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly fieldPath?: string;
};

export type NovelDraftRebaseDetails = {
  readonly status: "rebased" | "not_required" | "conflicted" | "rejected";
  readonly baseRevision?: string;
  readonly conflictCount?: number;
  readonly conflicts?: NovelConflictSummary[];
  readonly reason?: string;
};
