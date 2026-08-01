/**
 * Projector- and Schema-specific Node access to one Workspace's Runtime
 * Message files and Journal-backed maintenance service.
 *
 * @example
 * ```ts
 * const context = workspaceStore.createMessageProjectionContext({ projector });
 * await context.projections.synchronize(conversationId);
 * const page = await context.messages.list({ conversationId });
 * await context.close();
 * ```
 */
import type {
  ConversationMessageFileStore,
  ConversationMessageProjectionService,
} from "../../storage/index.js";

export interface NodeConversationMessageProjectionContext {
  readonly messages: ConversationMessageFileStore;
  readonly projections: ConversationMessageProjectionService;

  close(): Promise<void>;
}
