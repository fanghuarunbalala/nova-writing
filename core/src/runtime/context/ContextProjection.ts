/** Per-Provider-call budgeted selection derived without mutating canonical history. */
export const CONTEXT_PROJECTION_DEGRADATION_LEVEL = {
  none: 0,
  strongerStructured: 1,
  artifactOffload: 2,
  priorityBudgeted: 3,
  recentWindowReduced: 4,
} as const;

export type ContextProjectionDegradationLevel =
  (typeof CONTEXT_PROJECTION_DEGRADATION_LEVEL)[keyof typeof CONTEXT_PROJECTION_DEGRADATION_LEVEL];

export interface ContextProjection {
  readonly conversationId: string;
  readonly providerCallId: string;
  readonly checkpointId?: string;
  readonly selectedCheckpointItemIds: readonly string[];
  readonly omittedCheckpointItemIds: readonly string[];
  readonly pinnedMessageIds: readonly string[];
  readonly recentMessageIds: readonly string[];
  readonly transientMessageCount: number;
  readonly degradationLevel: ContextProjectionDegradationLevel;
  readonly tokenEstimate: number;
}
