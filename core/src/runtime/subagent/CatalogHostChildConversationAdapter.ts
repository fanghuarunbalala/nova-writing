/** Creates child metadata through Catalog and activates it through ConversationHost. */
import { CONVERSATION_RUNTIME_ACTIVATION_REASON, CONVERSATION_RUNTIME_SHUTDOWN_REASON, type ConversationHost } from "../../conversation/host/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { ConversationCatalogStore } from "../../storage/index.js";
import type { ChildConversationActivationPort, ChildConversationCreateInput, ChildConversationCreation, ChildConversationCreationPort, ChildConversationRollbackPort } from "./ChildConversationManagerProtocol.js";
import type { SubagentBinding } from "./SubagentProtocol.js";

export interface ChildConversationIdFactory { create(input: ChildConversationCreateInput): string; }

export class CatalogHostChildConversationAdapter implements ChildConversationCreationPort, ChildConversationActivationPort, ChildConversationRollbackPort {
  readonly #logger: Logger;
  constructor(private readonly options: { catalog: ConversationCatalogStore; host: ConversationHost; idFactory: ChildConversationIdFactory; logger?: Logger }) { this.#logger = (options.logger ?? noopLogger).child({ component: "catalog_host_child_conversation_adapter" }); }
  async createChild(input: ChildConversationCreateInput): Promise<ChildConversationCreation> {
    const childConversationId = this.options.idFactory.create(input);
    const stored = await this.options.catalog.createConversation({ id: childConversationId, workspaceId: input.workspaceId, parentConversationId: input.parentConversationId, agent: { agentType: input.agentType, definitionVersion: input.definitionVersion }, createdAt: input.requestedAt });
    this.#logger.info("runtime.subagent.catalog_child_created", { subagentId: input.subagentId, parentConversationId: input.parentConversationId, parentRunId: input.parentRunId, childConversationId });
    return Object.freeze({ childConversationId: stored.metadata.id, createdAt: stored.metadata.createdAt });
  }
  async activateChild(binding: SubagentBinding): Promise<void> { await this.options.host.ensureActive({ conversationId: binding.childConversationId, reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore }); }
  async rollbackChild(binding: SubagentBinding): Promise<void> { await this.options.host.shutdownRuntime({ conversationId: binding.childConversationId, reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown }); }
}
