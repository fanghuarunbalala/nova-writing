/** Immutable Message-group pin contracts used by Context projection. */
export const CONTEXT_PIN_GROUP_KIND = {
  currentInput: "current_input",
  latestCompleteTurn: "latest_complete_turn",
  unresolvedInteraction: "unresolved_interaction",
  unresolvedApproval: "unresolved_approval",
  activeToolExecution: "active_tool_execution",
  explicit: "explicit",
  activeRun: "active_run",
} as const;

export type ContextPinGroupKind =
  (typeof CONTEXT_PIN_GROUP_KIND)[keyof typeof CONTEXT_PIN_GROUP_KIND];

export const CONTEXT_PIN_LIFETIME = {
  permanent: "permanent",
  conditional: "conditional",
  sliding: "sliding",
} as const;

export type ContextPinLifetime =
  (typeof CONTEXT_PIN_LIFETIME)[keyof typeof CONTEXT_PIN_LIFETIME];

export interface ContextPinnedMessageGroup {
  readonly id: string;
  readonly conversationId: string;
  readonly kind: ContextPinGroupKind;
  readonly lifetime: ContextPinLifetime;
  readonly messageIds: readonly string[];
  readonly tokenEstimate: number;
  readonly runId?: string;
  readonly turnId?: string;
}
