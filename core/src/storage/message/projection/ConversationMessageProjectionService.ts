/** Public orchestration boundary for inspecting, synchronizing, and rebuilding projections. */
import type {
  MessageProjectionInspection,
  MessageProjectionMaintenanceResult,
} from "./MessageProjectionMaintenance.js";

export interface MessageProjectionOperationOptions {
  signal?: AbortSignal;
}

export interface ConversationMessageProjectionService {
  inspect(
    conversationId: string,
    options?: MessageProjectionOperationOptions,
  ): Promise<MessageProjectionInspection>;

  synchronize(
    conversationId: string,
    options?: MessageProjectionOperationOptions,
  ): Promise<MessageProjectionMaintenanceResult>;

  rebuild(
    conversationId: string,
    options?: MessageProjectionOperationOptions,
  ): Promise<MessageProjectionMaintenanceResult>;
}
