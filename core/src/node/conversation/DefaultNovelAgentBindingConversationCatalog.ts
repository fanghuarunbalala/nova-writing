/** Completes default Novel Agent bindings with the provisioned Manifest identity. */
import type { AgentManifest } from "../../agent/manifest/index.js";
import {
  type ConversationCatalogResult,
  type ConversationCatalogService,
  type ConversationSnapshot,
  type CreateConversationOptions,
  type ListConversationsOptions,
} from "../../conversation/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import { isDefaultNovelConversationAgent } from "../agent/manifest/index.js";

export class DefaultNovelAgentBindingConversationCatalog
  implements ConversationCatalogService
{
  readonly #delegate: ConversationCatalogService;
  readonly #defaultManifest: AgentManifest;
  readonly #logger: Logger;

  constructor(
    delegate: ConversationCatalogService,
    defaultManifest: AgentManifest,
    options: { readonly logger?: Logger } = {},
  ) {
    this.#delegate = delegate;
    this.#defaultManifest = defaultManifest;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "default_novel_agent_binding_conversation_catalog",
    });
  }

  async create(
    options: CreateConversationOptions,
  ): Promise<ConversationSnapshot> {
    return this.#delegate.create(completeDefaultBinding(options, this.#defaultManifest, this.#logger));
  }

  list(
    options?: ListConversationsOptions,
  ): Promise<ConversationCatalogResult> {
    return this.#delegate.list(options);
  }

  rename(conversationId: string, title: string): Promise<ConversationSnapshot> {
    return this.#delegate.rename(conversationId, title);
  }

  pin(conversationId: string, pinned: boolean): Promise<ConversationSnapshot> {
    return this.#delegate.pin(conversationId, pinned);
  }

  delete(conversationId: string): Promise<void> {
    return this.#delegate.delete(conversationId);
  }
}

function completeDefaultBinding(
  options: CreateConversationOptions,
  defaultManifest: AgentManifest,
  logger: Logger,
): CreateConversationOptions {
  if (
    options.agent.manifestId !== undefined ||
    !isDefaultNovelConversationAgent(
      options.agent.agentType,
      options.agent.definitionVersion,
    )
  ) {
    return options;
  }
  logger.info("conversation_catalog.default_binding_completed", {
    agentType: options.agent.agentType,
    definitionVersion: options.agent.definitionVersion,
    manifestId: defaultManifest.manifestId,
    manifestDigest: defaultManifest.manifestDigest,
  });
  return {
    ...options,
    agent: {
      agentType: options.agent.agentType,
      definitionVersion: options.agent.definitionVersion,
      manifestId: defaultManifest.manifestId,
      manifestDigest: defaultManifest.manifestDigest,
    },
  };
}
