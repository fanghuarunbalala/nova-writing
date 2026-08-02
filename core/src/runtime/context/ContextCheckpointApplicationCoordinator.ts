/** Publishes one idempotent Checkpoint-applied Event at Provider dispatch. */
import { ContextCheckpointAppliedOutputEvent, OUTPUT_EVENT_TYPE } from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { RuntimeEventAppendReceipt, RuntimeEventSink } from "../execution/index.js";

export interface ContextCheckpointApplicationEventIdFactory { create(input: { conversationId: string; runId: string; providerCallId: string; checkpointId: string; eventType: string }): string; }
export interface ContextCheckpointApplicationRequest { conversationId: string; runId: string; providerCallId: string; checkpointId: string; dispatchedAt: string; }
export class ContextCheckpointApplicationCoordinator {
  private readonly logger: Logger;
  constructor(private readonly options: { eventSink: RuntimeEventSink; eventIdFactory: ContextCheckpointApplicationEventIdFactory; logger?: Logger }) { this.logger = (options.logger ?? noopLogger).child({ component: "context_checkpoint_application_coordinator" }); }
  async confirmDispatched(request: ContextCheckpointApplicationRequest): Promise<RuntimeEventAppendReceipt> { try { const receipt = await this.options.eventSink.append(new ContextCheckpointAppliedOutputEvent({ conversationId: request.conversationId, runId: request.runId, providerCallId: request.providerCallId, checkpointId: request.checkpointId, timestamp: request.dispatchedAt, id: this.options.eventIdFactory.create({ ...request, eventType: OUTPUT_EVENT_TYPE.contextCheckpointApplied }) })); this.logger.info("runtime.context.checkpoint_application_published", { conversationId: request.conversationId, runId: request.runId, providerCallId: request.providerCallId, checkpointId: request.checkpointId }); return receipt; } catch { this.logger.error("runtime.context.checkpoint_application_failed", { conversationId: request.conversationId, runId: request.runId, providerCallId: request.providerCallId, checkpointId: request.checkpointId }); throw new ContextCheckpointApplicationCoordinatorError(); } }
}
export class ContextCheckpointApplicationCoordinatorError extends Error { override readonly name = "ContextCheckpointApplicationCoordinatorError"; readonly code = "CONTEXT_CHECKPOINT_APPLICATION_FAILED" as const; constructor() { super("Context Checkpoint application publication failed"); } }
