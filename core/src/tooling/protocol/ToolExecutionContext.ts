/** Minimal Provider-neutral identity and cancellation context supplied to a Tool. */
export interface ToolExecutionContext {
  readonly conversationId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly turnId?: string;
  readonly signal: AbortSignal;
}
