/** Awaited Pi-event bridge implemented by later Core lifecycle/output mapping. */
import type { AgentEvent } from "@earendil-works/pi-agent-core";

export interface PiAgentEventBridgeRequest {
  readonly conversationId: string;
  readonly runId: string;
  readonly event: AgentEvent;
  readonly signal: AbortSignal;
}

export interface PiAgentEventBridge {
  handle(request: PiAgentEventBridgeRequest): Promise<void>;
}
