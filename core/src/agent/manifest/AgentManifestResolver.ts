/** Resolves an Agent Definition into a reproducible Prompt and Tool Manifest. */
import { canonicalStringifyJson, type JsonValue } from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { AgentDefinition } from "../definition/AgentDefinition.js";
import {
  AgentManifest,
  AgentManifestDelegation,
  AgentManifestPrompt,
  AgentManifestTool,
  type AgentManifestDigest,
} from "./AgentManifest.js";
import {
  ResolvedInlinePromptItem,
  ResolvedPromptPlanItem,
  ResolvedPromptRecipe,
  ResolvedPromptSectionItem,
} from "./ResolvedPromptRecipe.js";
import type { PromptCapabilitySnapshot } from "../../prompt/PromptCapabilitySnapshot.js";
import type { PromptDigester } from "../../prompt/PromptDigester.js";
import type {
  CompiledSystemPrompt,
} from "../../prompt/CompiledSystemPrompt.js";
import {
  InlinePromptItem,
  PromptSectionItem,
} from "../../prompt/PromptPlanItem.js";
import type { PromptSectionRegistry } from "../../prompt/section/PromptSectionRegistry.js";
import type { ManifestSystemPromptCompiler } from "../../prompt/ManifestSystemPromptCompiler.js";
import {
  createLegacyResolvedAgentCapabilities,
  type ResolvedAgentCapabilities,
} from "../capability/index.js";

export interface AgentManifestIdFactory {
  create(input: {
    readonly agentType: string;
    readonly definitionVersion: string;
  }): string | Promise<string>;
}

export interface AgentManifestClock {
  now(): string;
}

export interface AgentManifestResolverOptions {
  readonly promptBuilder: ManifestSystemPromptCompiler;
  readonly promptCapabilities: PromptCapabilitySnapshot;
  readonly manifestIdFactory: AgentManifestIdFactory;
  readonly clock: AgentManifestClock;
  readonly digester: PromptDigester;
  readonly logger?: Logger;
}

export class AgentManifestResolver {
  readonly #promptBuilder: ManifestSystemPromptCompiler;
  readonly #promptCapabilities: PromptCapabilitySnapshot;
  readonly #manifestIdFactory: AgentManifestIdFactory;
  readonly #clock: AgentManifestClock;
  readonly #digester: PromptDigester;
  readonly #logger: Logger;

  constructor(options: AgentManifestResolverOptions) {
    this.#promptBuilder = options.promptBuilder;
    this.#promptCapabilities = options.promptCapabilities;
    this.#manifestIdFactory = options.manifestIdFactory;
    this.#clock = options.clock;
    this.#digester = options.digester;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "agent_manifest_resolver",
    });
  }

  async resolve(
    definition: AgentDefinition,
    promptCapabilities: PromptCapabilitySnapshot = this.#promptCapabilities,
    resolvedCapabilities?: ResolvedAgentCapabilities,
  ): Promise<AgentManifest> {
    const manifestId = await this.#manifestIdFactory.create({
      agentType: definition.agentType,
      definitionVersion: definition.definitionVersion,
    });
    const createdAt = this.#clock.now();
    this.#logger.debug("agent_manifest.resolve_started", {
      agentType: definition.agentType,
      definitionVersion: definition.definitionVersion,
    });

    const compiledPrompt = await this.#promptBuilder.compile({
      definition,
      capabilities: promptCapabilities,
    });
    const promptRecipe = resolvePromptRecipe(
      definition,
      compiledPrompt,
      this.#promptBuilder.sections,
    );
    const capabilityProfile = resolvedCapabilities ??
      createLegacyResolvedAgentCapabilities(
        definition,
        promptRecipe.items
          .filter((item): item is ResolvedPromptSectionItem =>
            item instanceof ResolvedPromptSectionItem)
          .map((item) => item.sectionId),
      );
    const tools = promptCapabilities.tools.map(
      (tool) => new AgentManifestTool({ name: tool.name, version: tool.version }),
    );
    const delegation = new AgentManifestDelegation({
      mode: definition.delegation.mode,
      allowedAgentTypes: definition.delegation.allowedAgentTypes,
    });
    const prompt = new AgentManifestPrompt({
      content: compiledPrompt.content,
      digest: compiledPrompt.digest,
    });
    const digest = await this.#digester.digest(
      canonicalStringifyJson(
        buildManifestDigestPayload({
          manifestId,
          createdAt,
          definition,
          promptRecipe,
          compiledPrompt: prompt,
          tools,
          delegation,
          capabilityProfile,
          communicationRole: definition.communication.role,
          runtimePolicyId: definition.runtimePolicyId,
        }) as JsonValue,
      ),
    );
    const manifest = new AgentManifest({
      manifestId,
      manifestDigest: digest as AgentManifestDigest,
      definition,
      promptRecipe,
      compiledPrompt: prompt,
      tools,
      delegation,
      capabilityProfile,
      communicationRole: definition.communication.role,
      runtimePolicyId: definition.runtimePolicyId,
      createdAt,
    });
    this.#logger.info("agent_manifest.resolve_completed", {
      agentType: manifest.agentType,
      definitionVersion: manifest.definitionVersion,
      promptSectionCount: manifest.promptRecipe.items.filter(
        (item) => item.kind === "section",
      ).length,
      toolCount: manifest.tools.length,
      manifestDigest: manifest.manifestDigest,
    });
    return manifest;
  }
}

function resolvePromptRecipe(
  definition: AgentDefinition,
  compiledPrompt: CompiledSystemPrompt,
  sections: PromptSectionRegistry,
): ResolvedPromptRecipe {
  const items: ResolvedPromptPlanItem[] = [];
  const blocks = compiledPrompt.blocks;
  let blockIndex = 0;
  for (const item of definition.promptRecipe.items) {
    if (item instanceof PromptSectionItem) {
      const section = sections.resolve(item.sectionId, item.requestedVersion);
      if (section.kind === "dynamic") {
        items.push(new ResolvedPromptSectionItem({
          sectionId: section.id,
          version: section.version,
        }));
        continue;
      }
      const block = blocks[blockIndex++];
      if (
        block === undefined ||
        block.sourceKind !== "section" ||
        block.sourceId !== item.sectionId ||
        block.sourceVersion === undefined
      ) {
        throw new TypeError("Compiled Prompt Section identity does not match Recipe");
      }
      items.push(new ResolvedPromptSectionItem({
        sectionId: block.sourceId,
        version: block.sourceVersion,
      }));
      continue;
    }
    if (item instanceof InlinePromptItem) {
      const block = blocks[blockIndex++];
      if (block === undefined || block.sourceKind !== "inline") {
        throw new TypeError("Compiled inline Prompt identity does not match Recipe");
      }
      items.push(new ResolvedInlinePromptItem({
        sourceId: block.sourceId,
        content: block.content,
      }));
      continue;
    }
    throw new TypeError("Prompt Recipe item is unsupported");
  }
  if (blockIndex !== blocks.length) {
    throw new TypeError("Compiled Prompt block count does not match Recipe");
  }
  return new ResolvedPromptRecipe(items);
}

interface ManifestDigestPayloadOptions {
  readonly manifestId: string;
  readonly createdAt: string;
  readonly definition: AgentDefinition;
  readonly promptRecipe: ResolvedPromptRecipe;
  readonly compiledPrompt: AgentManifestPrompt;
  readonly tools: readonly AgentManifestTool[];
  readonly delegation: AgentManifestDelegation;
  readonly capabilityProfile: ResolvedAgentCapabilities;
  readonly communicationRole: string;
  readonly runtimePolicyId: string;
}

function buildManifestDigestPayload(
  options: ManifestDigestPayloadOptions,
): Record<string, JsonValue> {
  return {
    schemaVersion: 1,
    manifestId: options.manifestId,
    createdAt: options.createdAt,
    definition: options.definition.toSnapshot() as unknown as JsonValue,
    agentType: options.definition.agentType,
    definitionVersion: options.definition.definitionVersion,
    promptRecipe: options.promptRecipe.toSnapshot() as unknown as JsonValue,
    compiledPrompt: options.compiledPrompt.toSnapshot() as unknown as JsonValue,
    tools: options.tools.map((tool) => tool.toSnapshot()) as unknown as JsonValue,
    delegation: options.delegation.toSnapshot() as unknown as JsonValue,
    capabilityProfile: options.capabilityProfile.toSnapshot() as unknown as JsonValue,
    communicationRole: options.communicationRole,
    runtimePolicyId: options.runtimePolicyId,
  };
}
