/** Creates child metadata through Catalog and activates it through ConversationHost. */
import { CONVERSATION_RUNTIME_ACTIVATION_REASON, CONVERSATION_RUNTIME_SHUTDOWN_REASON, type ConversationHost } from "../../conversation/host/index.js";
import type { ConversationCommandService } from "../../conversation/ConversationCommandService.js";
import { TaskAssignedInputEvent } from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { ConversationCatalogStore } from "../../storage/index.js";
import type { ChildConversationActivationPort, ChildConversationCreateInput, ChildConversationCreation, ChildConversationCreationPort, ChildConversationRollbackPort, ChildConversationTaskAssignmentPort } from "./ChildConversationManagerProtocol.js";
import type { SubagentBinding, SubagentRequest } from "./SubagentProtocol.js";

export interface ChildConversationIdFactory { create(input: ChildConversationCreateInput): string; }

export class CatalogHostChildConversationAdapter implements ChildConversationCreationPort, ChildConversationActivationPort, ChildConversationRollbackPort, ChildConversationTaskAssignmentPort {
  readonly #logger: Logger;
  constructor(private readonly options: { catalog: ConversationCatalogStore; host: ConversationHost; commandService?: ConversationCommandService; idFactory: ChildConversationIdFactory; logger?: Logger }) { this.#logger = (options.logger ?? noopLogger).child({ component: "catalog_host_child_conversation_adapter" }); }
  async createChild(input: ChildConversationCreateInput): Promise<ChildConversationCreation> {
    const childConversationId = this.options.idFactory.create(input);
    const stored = await this.options.catalog.createConversation({ id: childConversationId, workspaceId: input.workspaceId, parentConversationId: input.parentConversationId, agent: { agentType: input.agentType, definitionVersion: input.definitionVersion }, createdAt: input.requestedAt });
    this.#logger.info("runtime.subagent.catalog_child_created", { subagentId: input.subagentId, parentConversationId: input.parentConversationId, parentRunId: input.parentRunId, childConversationId });
    return Object.freeze({ childConversationId: stored.metadata.id, createdAt: stored.metadata.createdAt });
  }
  async activateChild(binding: SubagentBinding): Promise<void> { await this.options.host.ensureActive({ conversationId: binding.childConversationId, reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore }); }
  async assignTask(binding: SubagentBinding, request: SubagentRequest) {
    if (this.options.commandService === undefined) {
      throw new Error("Child task command service is not configured");
    }
    return this.options.commandService.enqueue(
      binding.childConversationId,
      new TaskAssignedInputEvent({
        id: `task-assigned-${request.subagentId}`,
        conversationId: binding.childConversationId,
        correlationId: request.parentConversationId,
        causationId: request.subagentId,
        taskId: request.subagentId,
        requesterConversationId: request.parentConversationId,
        prompt: request.objective,
        artifactReferences: request.artifactReferences ?? [],
      }),
    );
  }
  async rollbackChild(binding: SubagentBinding): Promise<void> { await this.options.host.shutdownRuntime({ conversationId: binding.childConversationId, reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown }); }
}
