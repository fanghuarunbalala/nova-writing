/** Idempotent production provisioner for the default Novel Conversation Agent. */
import {
  AgentAssembler,
  AgentManifestResolver,
  AgentManifestStoreError,
  type AgentManifest,
  type AgentManifestClock,
  type AgentManifestIdFactory,
  type AgentManifestProvisioner,
  type AgentManifestStore,
} from "../../../agent/manifest/index.js";
import { novelAgentDefinition } from "../../../agent/definitions/index.js";
import { canonicalStringifyJson, type JsonValue } from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import { PromptCapabilitySnapshot } from "../../../prompt/index.js";
import {
  createNovelConversationManifestComposition,
  type NovelConversationManifestComposition,
} from "./NovelConversationManifestComposition.js";

export const DEFAULT_NOVEL_AGENT_MANIFEST_ID = "manifest:novel:1.3.0" as const;

export type DefaultNovelConversationManifestFailure = "conflict" | "mismatch";

export class DefaultNovelConversationManifestError extends Error {
  override readonly name = "DefaultNovelConversationManifestError";
  readonly failure: DefaultNovelConversationManifestFailure;
  readonly code:
    | "DEFAULT_NOVEL_MANIFEST_CONFLICT"
    | "DEFAULT_NOVEL_MANIFEST_MISMATCH";

  constructor(failure: DefaultNovelConversationManifestFailure) {
    super(`Default Novel Conversation Manifest failed (${failure})`);
    this.failure = failure;
    this.code =
      failure === "conflict"
        ? "DEFAULT_NOVEL_MANIFEST_CONFLICT"
        : "DEFAULT_NOVEL_MANIFEST_MISMATCH";
  }
}

const DEFAULT_NOVEL_AGENT_MANIFEST_ID_FACTORY: AgentManifestIdFactory = Object.freeze({
  create() {
    return DEFAULT_NOVEL_AGENT_MANIFEST_ID;
  },
});

const SYSTEM_MANIFEST_CLOCK: AgentManifestClock = Object.freeze({
  now: () => new Date().toISOString(),
});

export function isDefaultNovelConversationAgent(
  agentType: string,
  definitionVersion: string,
): boolean {
  return (
    agentType === novelAgentDefinition.agentType &&
    definitionVersion === novelAgentDefinition.definitionVersion
  );
}

export class DefaultNovelConversationManifestProvisioner
  implements AgentManifestProvisioner
{
  readonly #logger: Logger;
  readonly #composition: NovelConversationManifestComposition;

  constructor(options: { readonly logger?: Logger } = {}) {
    this.#logger = (options.logger ?? noopLogger).child({
      component: "default_novel_conversation_manifest_provisioner",
    });
    this.#composition = createNovelConversationManifestComposition();
  }

  async provision(store: AgentManifestStore): Promise<AgentManifest> {
    const existing = await store.get(DEFAULT_NOVEL_AGENT_MANIFEST_ID);
    if (existing !== undefined) {
      assertDefaultNovelAgentIdentity(existing);
      this.#warnOnDefinitionDrift(existing);
      this.#logger.debug("default_manifest.reused", {
        agentType: existing.agentType,
        definitionVersion: existing.definitionVersion,
        manifestDigest: existing.manifestDigest,
      });
      return existing;
    }
    const assembler = new AgentAssembler({
      registry: this.#composition.registry,
      groups: this.#composition.groups,
      manifestResolver: new AgentManifestResolver({
        promptBuilder: this.#composition.promptBuilder,
        promptCapabilities: new PromptCapabilitySnapshot([]),
        manifestIdFactory: DEFAULT_NOVEL_AGENT_MANIFEST_ID_FACTORY,
        clock: SYSTEM_MANIFEST_CLOCK,
        digester: this.#composition.digester,
        logger: this.#logger,
      }),
      manifestStore: store,
      logger: this.#logger,
    });
    try {
      const assembly = await assembler.assemble(novelAgentDefinition);
      this.#logger.info("default_manifest.provisioned", {
        agentType: assembly.agentType,
        definitionVersion: assembly.definitionVersion,
        manifestDigest: assembly.manifest.manifestDigest,
      });
      return assembly.manifest;
    } catch (error) {
      if (
        error instanceof AgentManifestStoreError &&
        error.failure === "manifest_conflict"
      ) {
        throw new DefaultNovelConversationManifestError("conflict");
      }
      throw error;
    }
  }

  /** 定义快照与当前定义不一致时告警（防"改了定义但忘了 bump 版本"的静默退化）。只 warn 不 throw，避免旧会话 bootstrap 崩溃。 */
  #warnOnDefinitionDrift(manifest: AgentManifest): void {
    const current = canonicalStringifyJson(
      novelAgentDefinition.toSnapshot() as unknown as JsonValue,
    );
    const stored = canonicalStringifyJson(
      manifest.definition as unknown as JsonValue,
    );
    if (current !== stored) {
      this.#logger.warn("default_manifest.definition_drift", {
        storedDefinitionVersion: manifest.definitionVersion,
        currentDefinitionVersion: novelAgentDefinition.definitionVersion,
      });
    }
  }
}

function assertDefaultNovelAgentIdentity(manifest: AgentManifest): void {
  if (
    !isDefaultNovelConversationAgent(
      manifest.agentType,
      manifest.definitionVersion,
    )
  ) {
    throw new DefaultNovelConversationManifestError("mismatch");
  }
}
