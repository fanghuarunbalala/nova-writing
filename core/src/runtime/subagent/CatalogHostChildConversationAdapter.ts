/** Creates Manifest-backed child metadata through Catalog and activates it through ConversationHost. */
import type { AgentDefinitionCatalog } from "../../agent/definition/index.js";
import type { AgentAssembler } from "../../agent/manifest/index.js";
import {
  CONVERSATION_RUNTIME_ACTIVATION_REASON,
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  type ConversationHost,
} from "../../conversation/host/index.js";
import type { ConversationCommandService } from "../../conversation/ConversationCommandService.js";
import { TaskAssignedInputEvent } from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { ConversationCatalogStore } from "../../storage/index.js";
import type {
  ChildConversationActivationPort,
  ChildConversationCreateInput,
  ChildConversationCreation,
  ChildConversationCreationPort,
  ChildConversationRollbackPort,
  ChildConversationTaskAssignmentPort,
} from "./ChildConversationManagerProtocol.js";
import type { SubagentBinding, SubagentRequest } from "./SubagentProtocol.js";

export interface ChildConversationIdFactory {
  create(input: ChildConversationCreateInput): string;
}

export interface CatalogHostChildConversationAdapterOptions {
  readonly catalog: ConversationCatalogStore;
  readonly host: Pick<ConversationHost, "ensureActive" | "shutdownRuntime">;
  readonly agentDefinitions: AgentDefinitionCatalog;
  readonly agentAssembler: AgentAssembler;
  readonly commandService?: ConversationCommandService;
  readonly idFactory: ChildConversationIdFactory;
  readonly logger?: Logger;
}

export class CatalogHostChildConversationAdapter
  implements
    ChildConversationCreationPort,
    ChildConversationActivationPort,
    ChildConversationRollbackPort,
    ChildConversationTaskAssignmentPort
{
  readonly #logger: Logger;
  constructor(private readonly options: CatalogHostChildConversationAdapterOptions) {
    this.#logger = (options.logger ?? noopLogger).child({
      component: "catalog_host_child_conversation_adapter",
    });
  }

  async createChild(input: ChildConversationCreateInput): Promise<ChildConversationCreation> {
    const childConversationId = this.options.idFactory.create(input);
    const definition = this.options.agentDefinitions.resolve(
      input.agentType,
      input.definitionVersion,
    );
    const assembly = await this.options.agentAssembler.assemble(definition);
    if (
      assembly.agentType !== input.agentType ||
      assembly.definitionVersion !== input.definitionVersion
    ) {
      throw new Error("Subagent Agent Manifest identity mismatch");
    }
    const stored = await this.options.catalog.createConversation({
      id: childConversationId,
      workspaceId: input.workspaceId,
      parentConversationId: input.parentConversationId,
      agent: {
        agentType: assembly.manifest.definition.agentType,
        definitionVersion: assembly.manifest.definition.definitionVersion,
        manifestId: assembly.manifest.manifestId,
        manifestDigest: assembly.manifest.manifestDigest,
      },
      createdAt: input.requestedAt,
    });
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
