/** Completes default Novel Agent bindings with the provisioned Manifest identity. */
import type { AgentManifest } from "../../agent/manifest/index.js";
import { novelAgentDefinition } from "../../agent/definitions/index.js";
import {
  type ConversationCatalogResult,
  type ConversationCatalogService,
  type ConversationSnapshot,
  type CreateConversationOptions,
  type ListConversationsOptions,
} from "../../conversation/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";

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
  // 已带 manifest 身份，或非默认 novel agent 类型：不补写。版本不做相等校验：
  // renderer 构建产物可能捆绑旧 definitionVersion（如 1.4.0），一旦漂移，若在此
  // 拒绝补写会导致新会话 binding 落库无 manifest，child runtime 组合直接崩溃。
  // Align on the novel agent TYPE rather than the version string: the bundled
  // renderer value can drift from the provisioned definition, and refusing to
  // complete here would persist a manifest-less binding and crash bootstrap.
  if (
    options.agent.manifestId !== undefined ||
    options.agent.agentType !== novelAgentDefinition.agentType
  ) {
    return options;
  }
  logger.info("conversation_catalog.default_binding_completed", {
    agentType: options.agent.agentType,
    definitionVersion: defaultManifest.definitionVersion,
    manifestId: defaultManifest.manifestId,
    manifestDigest: defaultManifest.manifestDigest,
  });
  return {
    ...options,
    agent: {
      agentType: options.agent.agentType,
      // 绑定 identity 一律以 provisioned 默认 manifest 为准：definitionVersion 也
      // 必须同步，否则运行时 assertManifestMatchesBinding 会判 manifestMismatch。
      // Override both version and manifest identity from the default manifest so
      // runtime restore matches the binding against the persisted manifest.
      definitionVersion: defaultManifest.definitionVersion,
      manifestId: defaultManifest.manifestId,
      manifestDigest: defaultManifest.manifestDigest,
    },
  };
}
