/** Stable provider-neutral Compaction outcomes and safe unreducible reasons. */
export const CONTEXT_COMPACTION_OUTCOME = {
  targetMet: "target_met",
  reduced: "reduced",
  degraded: "degraded",
  unreducible: "unreducible",
} as const;

export type ContextCompactionOutcome =
  (typeof CONTEXT_COMPACTION_OUTCOME)[keyof typeof CONTEXT_COMPACTION_OUTCOME];

export const CONTEXT_UNREDUCIBLE_REASON = {
  currentInputTooLarge: "current_input_too_large",
  basePromptTooLarge: "base_prompt_too_large",
  toolSchemaTooLarge: "tool_schema_too_large",
  pinnedContextTooLarge: "pinned_context_too_large",
  transientContextTooLarge: "transient_context_too_large",
  compactionInsufficient: "compaction_insufficient",
} as const;

export type ContextUnreducibleReason =
  (typeof CONTEXT_UNREDUCIBLE_REASON)[keyof typeof CONTEXT_UNREDUCIBLE_REASON];

export interface ContextCompactionAttemptIdentity {
  readonly conversationId: string;
  readonly sourceDigest: string;
  readonly compactorId: string;
  readonly compactorVersion: string;
}

export interface ContextCompactionAssessment {
  readonly conversationId: string;
  readonly runId: string;
  readonly providerCallId: string;
  readonly outcome: ContextCompactionOutcome;
  readonly tokenEstimateBefore: number;
  readonly tokenEstimateAfter: number;
  readonly irreducibleFloorTokens: number;
  readonly targetTokens: number;
  readonly compactionRequestTokens: number;
  readonly hardAdmissionTokens: number;
  readonly minimumSavingsTokens: number;
  readonly targetAchieved: boolean;
  readonly meaningfulReduction: boolean;
  readonly checkpointId?: string;
  readonly unreducibleReason?: ContextUnreducibleReason;
  readonly completedAt: string;
}
