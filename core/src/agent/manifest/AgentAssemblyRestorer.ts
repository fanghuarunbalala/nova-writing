/** Restores an AgentAssembly from an immutable Manifest without rebuilding its Prompt. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { ToolGroupCatalog } from "../../tooling/group/ToolGroupCatalog.js";
import type { ToolRegistry } from "../../tooling/registry/ToolRegistry.js";
import { ToolRegistryView } from "../../tooling/registry/ToolRegistryView.js";
import { AgentAssembly } from "./AgentAssembly.js";
import type { AgentManifest } from "./AgentManifest.js";

export interface AgentAssemblyRestorerOptions {
  readonly registry: ToolRegistry;
  readonly groups: ToolGroupCatalog;
  readonly logger?: Logger;
}

export class AgentAssemblyRestorer {
  readonly #registry: ToolRegistry;
  readonly #groups: ToolGroupCatalog;
  readonly #logger: Logger;

  constructor(options: AgentAssemblyRestorerOptions) {
    this.#registry = options.registry;
    this.#groups = options.groups;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "agent_assembly_restorer",
    });
  }

  restore(manifest: AgentManifest): AgentAssembly {
    this.#logger.debug("agent_assembly.restore_started", {
      agentType: manifest.agentType,
      definitionVersion: manifest.definitionVersion,
      manifestDigest: manifest.manifestDigest,
    });
    const toolView = new ToolRegistryView({
      registry: this.#registry,
      groups: this.#groups,
      policy: manifest.definition.tools,
    });
    assertManifestToolsMatchView(manifest, toolView);
    const assembly = new AgentAssembly({ manifest, toolView });
    this.#logger.info("agent_assembly.restore_completed", {
      agentType: assembly.agentType,
      definitionVersion: assembly.definitionVersion,
      manifestDigest: manifest.manifestDigest,
      toolCount: toolView.size,
    });
    return assembly;
  }
}

function assertManifestToolsMatchView(
  manifest: AgentManifest,
  view: ToolRegistryView,
): void {
  const resolved = new Map(
    view.listAllowed().map((tool) => [
      tool.descriptor.name,
      tool.descriptor.version,
    ]),
  );
  if (resolved.size !== manifest.tools.length) {
    throw new TypeError("Restored Tool View does not match Agent Manifest");
  }
  for (const tool of manifest.tools) {
    if (resolved.get(tool.name) !== tool.version) {
      throw new TypeError("Restored Tool View does not match Agent Manifest");
    }
  }
}
