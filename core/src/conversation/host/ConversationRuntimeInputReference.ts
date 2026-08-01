/**
 * Payload-free durable InputEvent reference dispatched to a Runtime endpoint.
 *
 * The Runtime resolves the canonical Event through Conversation ID and Journal
 * Sequence instead of trusting a copied payload.
 */
export interface ConversationRuntimeInputReference {
  readonly conversationId: string;
  readonly inputEventId: string;
  readonly eventType: string;
  readonly sequence: number;
  readonly correlationId?: string;
  readonly runId?: string;
  readonly turnId?: string;
}
