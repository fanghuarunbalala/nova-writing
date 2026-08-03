/** Assembles a Definition, immutable Tool View, Prompt, and Manifest for Runtime use. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  PromptCapabilitySnapshot,
} from "../../prompt/PromptCapabilitySnapshot.js";
import {
  ToolGroupCatalog,
} from "../../tooling/group/ToolGroupCatalog.js";
import { ToolRegistry } from "../../tooling/registry/ToolRegistry.js";
import {
  ToolRegistryView,
  type ToolRegistryViewPolicy,
} from "../../tooling/registry/ToolRegistryView.js";
import {
  AgentDefinition,
} from "../definition/AgentDefinition.js";
import type { AgentManifest } from "./AgentManifest.js";
import { AgentAssembly } from "./AgentAssembly.js";
import type { AgentManifestResolver } from "./AgentManifestResolver.js";
import type { AgentManifestStore } from "./AgentManifestStore.js";

export interface AgentAssemblerOptions {
  readonly registry: ToolRegistry;
  readonly groups: ToolGroupCatalog;
  readonly manifestResolver: AgentManifestResolver;
  readonly manifestStore: AgentManifestStore;
  readonly logger?: Logger;
}

export class AgentAssembler {
  readonly #registry: ToolRegistry;
  readonly #groups: ToolGroupCatalog;
  readonly #manifestResolver: AgentManifestResolver;
  readonly #manifestStore: AgentManifestStore;
  readonly #logger: Logger;

  constructor(options: AgentAssemblerOptions) {
    if (!(options.registry instanceof ToolRegistry)) {
      throw new TypeError("Agent Assembler Tool Registry is invalid");
    }
    if (!(options.groups instanceof ToolGroupCatalog)) {
      throw new TypeError("Agent Assembler Tool Group Catalog is invalid");
    }
    this.#registry = options.registry;
    this.#groups = options.groups;
    this.#manifestResolver = options.manifestResolver;
    this.#manifestStore = options.manifestStore;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "agent_assembler",
    });
  }

  async assemble(definition: AgentDefinition): Promise<AgentAssembly> {
    if (!(definition instanceof AgentDefinition)) {
      throw new TypeError("Agent Definition is invalid");
    }
    this.#logger.debug("agent_assembler.assembly_started", {
      agentType: definition.agentType,
      definitionVersion: definition.definitionVersion,
    });

    const toolView = new ToolRegistryView({
      registry: this.#registry,
      groups: this.#groups,
      policy: toToolViewPolicy(definition),
    });
    const capabilities = new PromptCapabilitySnapshot(
      toolView.listAllowed().map((tool) => ({
        name: tool.descriptor.name,
        version: tool.descriptor.version,
        label: tool.descriptor.label,
        description: tool.descriptor.description,
      })),
    );
    const manifest = await this.#manifestResolver.resolve(
      definition,
      capabilities,
    );
    assertManifestToolsMatchView(manifest, toolView);
    await this.#manifestStore.save(manifest);

    const assembly = new AgentAssembly({ manifest, toolView });
    this.#logger.info("agent_assembler.assembly_completed", {
      agentType: assembly.agentType,
      definitionVersion: assembly.definitionVersion,
      toolCount: toolView.size,
      manifestDigest: manifest.manifestDigest,
    });
    return assembly;
  }
}

function toToolViewPolicy(definition: AgentDefinition): ToolRegistryViewPolicy {
  const policy = definition.tools.toSnapshot();
  return {
    groupIds: policy.groupIds,
    ...(policy.allow === undefined ? {} : { allow: policy.allow }),
    ...(policy.deny === undefined ? {} : { deny: policy.deny }),
  };
}

function assertManifestToolsMatchView(
  manifest: AgentManifest,
  toolView: ToolRegistryView,
): void {
  const viewTools = toolView.listAllowed();
  if (manifest.tools.length !== viewTools.length) {
    throw new TypeError("Agent Manifest Tool snapshot does not match Tool View");
  }
  const manifestTools = new Map(
    manifest.tools.map((tool) => [tool.name, tool.version]),
  );
  for (const tool of viewTools) {
    if (manifestTools.get(tool.descriptor.name) !== tool.descriptor.version) {
      throw new TypeError("Agent Manifest Tool snapshot does not match Tool View");
    }
  }
}
