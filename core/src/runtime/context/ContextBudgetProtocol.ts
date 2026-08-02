/** Provider-neutral Context budget, pressure, and token-estimate contracts. */
export const CONTEXT_BUDGET_DEFAULTS = {
  softReminderRatio: 0.7,
  compactionRequestRatio: 0.82,
  targetPostCompactionRatio: 0.55,
  hardAdmissionRatio: 0.92,
  minimumNewContentRatio: 0.1,
  minimumNewContentTokens: 8_192,
  minimumSavingsRatio: 0.05,
  minimumSavingsTokens: 2_048,
} as const;

export interface ContextBudgetThresholds {
  readonly softReminderRatio: number;
  readonly compactionRequestRatio: number;
  readonly targetPostCompactionRatio: number;
  readonly hardAdmissionRatio: number;
  readonly minimumNewContentRatio: number;
  readonly minimumNewContentTokens: number;
  readonly minimumSavingsRatio: number;
  readonly minimumSavingsTokens: number;
}

export interface EffectiveContextBudget {
  readonly providerContextWindowTokens: number;
  readonly reservedOutputTokens: number;
  readonly protocolOverheadTokens: number;
  readonly safetyReserveTokens: number;
  readonly effectiveInputTokens: number;
  readonly thresholds: ContextBudgetThresholds;
}

export interface ContextInputTokenEstimate {
  readonly baseSystemPromptTokens: number;
  readonly toolSchemaTokens: number;
  readonly checkpointOverlayTokens: number;
  readonly nudgeReserveTokens: number;
  readonly pinnedMessageTokens: number;
  readonly recentMessageTokens: number;
  readonly transientMessageTokens: number;
  readonly totalInputTokens: number;
}

export interface ContextIrreducibleFloorEstimate {
  readonly baseSystemPromptTokens: number;
  readonly toolSchemaTokens: number;
  readonly pinnedMessageTokens: number;
  readonly currentInputTokens: number;
  readonly transientMessageTokens: number;
  readonly protocolOverheadTokens: number;
  readonly totalTokens: number;
}

export const CONTEXT_PRESSURE_LEVEL = {
  normal: "normal",
  soft: "soft",
  compaction: "compaction",
  hard: "hard",
} as const;

export type ContextPressureLevel =
  (typeof CONTEXT_PRESSURE_LEVEL)[keyof typeof CONTEXT_PRESSURE_LEVEL];

export interface ContextPressureSnapshot {
  readonly conversationId: string;
  readonly runId: string;
  readonly providerCallId: string;
  readonly evaluatedAt: string;
  readonly budget: EffectiveContextBudget;
  readonly estimate: ContextInputTokenEstimate;
  readonly irreducibleFloor: ContextIrreducibleFloorEstimate;
  readonly usageRatio: number;
  readonly level: ContextPressureLevel;
}
