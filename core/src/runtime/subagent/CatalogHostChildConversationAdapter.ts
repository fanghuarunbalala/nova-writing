/** Creates Manifest-backed child metadata through Catalog and activates it through ConversationHost. */
import type {
  AgentDefinition,
  AgentDefinitionCatalog,
} from "../../agent/definition/index.js";
import {
  AgentManifestStoreError,
  type AgentAssembler,
  type AgentManifest,
  type AgentManifestIdFactory,
  type AgentManifestStore,
} from "../../agent/manifest/index.js";
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
  readonly manifestStore: AgentManifestStore;
  readonly manifestIdFactory: AgentManifestIdFactory;
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
    const manifest = await this.#provisionChildManifest(input, definition);
    const stored = await this.options.catalog.createConversation({
      id: childConversationId,
      workspaceId: input.workspaceId,
      parentConversationId: input.parentConversationId,
      agent: {
        agentType: manifest.agentType,
        definitionVersion: manifest.definitionVersion,
        manifestId: manifest.manifestId,
        manifestDigest: manifest.manifestDigest,
      },
      createdAt: input.requestedAt,
    });
    this.#logger.info("runtime.subagent.catalog_child_created", { subagentId: input.subagentId, parentConversationId: input.parentConversationId, parentRunId: input.parentRunId, childConversationId });
    return Object.freeze({ childConversationId: stored.metadata.id, createdAt: stored.metadata.createdAt });
  }

  /**
   * 子代理 manifest 装配：已存则复用，缺失才组装并保存。
   * Provisions the child Agent Manifest: reuse the stored manifest when present,
   * otherwise assemble and save. 镜像 DefaultNovelConversationManifestProvisioner
   * 的 get-first-reuse：manifest store 对稳定 manifestId 是写一次语义（digest 含
   * createdAt），而子代理 manifestId（`manifest:subagent:<type>:<version>`）跨 spawn
   * 稳定，若每次都重装配重保存，第二次 spawn 起必然 manifest_conflict。
   * Mirrors the Novel provisioner's get-first reuse: the manifest store is
   * write-once per stable id (digest embeds createdAt), yet the subagent id is
   * stable across spawns, so a fresh assemble+save on every spawn would fail
   * with manifest_conflict from the second spawn onward.
   */
  async #provisionChildManifest(
    input: ChildConversationCreateInput,
    definition: AgentDefinition,
  ): Promise<AgentManifest> {
    const manifestId = await this.options.manifestIdFactory.create({
      agentType: input.agentType,
      definitionVersion: input.definitionVersion,
    });
    const existing = await this.options.manifestStore.get(manifestId);
    if (existing !== undefined) {
      assertSubagentManifestIdentity(existing, input);
      this.#logger.debug("runtime.subagent.manifest_reused", {
        subagentId: input.subagentId,
        agentType: existing.agentType,
        definitionVersion: existing.definitionVersion,
        manifestDigest: existing.manifestDigest,
      });
      return existing;
    }
    try {
      const assembly = await this.options.agentAssembler.assemble(definition);
      assertSubagentManifestIdentity(assembly, input);
      return assembly.manifest;
    } catch (error) {
      if (
        error instanceof AgentManifestStoreError &&
        error.failure === "manifest_conflict"
      ) {
        // 并发首装竞态：另一进程刚写入同 id manifest，回退复用。
        // Concurrent first-install race: another runtime just saved the same id,
        // fall back to the stored manifest.
        const concurrent = await this.options.manifestStore.get(manifestId);
        if (concurrent === undefined) throw error;
        assertSubagentManifestIdentity(concurrent, input);
        this.#logger.debug("runtime.subagent.manifest_conflict_reused", {
          subagentId: input.subagentId,
          agentType: concurrent.agentType,
          definitionVersion: concurrent.definitionVersion,
          manifestDigest: concurrent.manifestDigest,
        });
        return concurrent;
      }
      throw error;
    }
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

function assertSubagentManifestIdentity(
  candidate: {
    readonly agentType: string;
    readonly definitionVersion: string;
  },
  input: ChildConversationCreateInput,
): void {
  if (
    candidate.agentType !== input.agentType ||
    candidate.definitionVersion !== input.definitionVersion
  ) {
    throw new Error("Subagent Agent Manifest identity mismatch");
  }
}
