/** Immutable provider-neutral Agent assembly consumed by a Conversation Runtime. */
import type { ToolRegistryView } from "../../tooling/registry/ToolRegistryView.js";
import type {
  AgentManifest,
  AgentManifestDigest,
  AgentManifestToolSnapshot,
} from "./AgentManifest.js";

export interface AgentAssemblySnapshot {
  readonly manifestId: string;
  readonly manifestDigest: AgentManifestDigest;
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly promptDigest: string;
  readonly tools: readonly AgentManifestToolSnapshot[];
}

export interface AgentAssemblyOptions {
  readonly manifest: AgentManifest;
  readonly toolView: ToolRegistryView;
}

export class AgentAssembly {
  readonly manifest: AgentManifest;
  readonly toolView: ToolRegistryView;

  constructor(options: AgentAssemblyOptions) {
    if (!isAgentManifest(options.manifest)) {
      throw new TypeError("Agent Assembly Manifest is invalid");
    }
    if (!isToolRegistryView(options.toolView)) {
      throw new TypeError("Agent Assembly Tool View is invalid");
    }
    this.manifest = options.manifest;
    this.toolView = options.toolView;
    Object.freeze(this);
  }

  get agentType(): string {
    return this.manifest.agentType;
  }

  get definitionVersion(): string {
    return this.manifest.definitionVersion;
  }

  get systemPrompt() {
    return this.manifest.compiledPrompt;
  }

  toSnapshot(): AgentAssemblySnapshot {
    return Object.freeze({
      manifestId: this.manifest.manifestId,
      manifestDigest: this.manifest.manifestDigest,
      agentType: this.manifest.agentType,
      definitionVersion: this.manifest.definitionVersion,
      promptDigest: this.manifest.compiledPrompt.digest,
      tools: Object.freeze(this.manifest.tools.map((tool) => tool.toSnapshot())),
    });
  }
}

function isAgentManifest(value: unknown): value is AgentManifest {
  return value !== null &&
    typeof value === "object" &&
    "manifestId" in value &&
    "manifestDigest" in value &&
    "compiledPrompt" in value;
}

function isToolRegistryView(value: unknown): value is ToolRegistryView {
  return value !== null &&
    typeof value === "object" &&
    "listAllowed" in value &&
    typeof value.listAllowed === "function";
}
