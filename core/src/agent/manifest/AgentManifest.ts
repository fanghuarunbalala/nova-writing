/** Immutable Agent Manifest freezing Definition, Prompt, Tool, and runtime identity. */
import { AgentDefinition, captureAgentType } from "../definition/AgentDefinition.js";
import type {
  AgentDefinitionSnapshot,
  AgentCommunicationRole,
  AgentDelegationMode,
} from "../definition/AgentDefinition.js";
import {
  capturePromptDigest,
  type PromptDigest,
} from "../../prompt/PromptDigester.js";
import { isToolName } from "../../tooling/protocol/ToolName.js";
import {
  ResolvedPromptRecipe,
  ResolvedPromptSectionItem,
  type ResolvedPromptRecipeSnapshot,
} from "./ResolvedPromptRecipe.js";
import {
  ResolvedAgentCapabilities,
  createLegacyResolvedAgentCapabilities,
  type ResolvedAgentCapabilitiesSnapshot,
} from "../capability/ResolvedAgentCapabilities.js";

export const LEGACY_AGENT_MANIFEST_SCHEMA_VERSION = 1 as const;
export const AGENT_MANIFEST_SCHEMA_VERSION = 2 as const;

export type AgentManifestDigest = `sha256:${string}`;

export interface AgentManifestPromptSnapshot {
  readonly content: string;
  readonly digest: PromptDigest;
}

export class AgentManifestPrompt {
  readonly content: string;
  readonly digest: PromptDigest;

  constructor(options: AgentManifestPromptSnapshot) {
    this.content = requireNonBlank(options.content, "Manifest Prompt content");
    this.digest = capturePromptDigest(options.digest);
    Object.freeze(this);
  }

  toSnapshot(): AgentManifestPromptSnapshot {
    return Object.freeze({
      content: this.content,
      digest: this.digest,
    });
  }
}

export interface AgentManifestToolSnapshot {
  readonly name: string;
  readonly version: string;
}

export class AgentManifestTool {
  readonly name: string;
  readonly version: string;

  constructor(options: AgentManifestToolSnapshot) {
    if (!isToolName(options.name)) {
      throw new TypeError("Manifest Tool name is invalid");
    }
    this.name = options.name;
    this.version = captureSemver(options.version, "Manifest Tool version");
    Object.freeze(this);
  }

  toSnapshot(): AgentManifestToolSnapshot {
    return Object.freeze({ name: this.name, version: this.version });
  }
}

export interface AgentManifestDelegationSnapshot {
  readonly mode: AgentDelegationMode;
  readonly allowedAgentTypes: readonly string[];
}

export class AgentManifestDelegation {
  readonly mode: AgentDelegationMode;
  readonly allowedAgentTypes: readonly string[];

  constructor(options: AgentManifestDelegationSnapshot) {
    if (!isDelegationMode(options.mode)) {
      throw new TypeError("Manifest delegation mode is invalid");
    }
    if (!Array.isArray(options.allowedAgentTypes)) {
      throw new TypeError("Manifest allowed Agent types are invalid");
    }
    this.mode = options.mode;
    const seen = new Set<string>();
    this.allowedAgentTypes = Object.freeze(
      options.allowedAgentTypes.map((agentType) => {
        const captured = captureAgentType(agentType);
        if (seen.has(captured)) {
          throw new TypeError("Manifest allowed Agent types must be unique");
        }
        seen.add(captured);
        return captured;
      }),
    );
    if (this.mode === "disabled" && this.allowedAgentTypes.length > 0) {
      throw new TypeError("Disabled Manifest delegation cannot allow Agent types");
    }
    Object.freeze(this);
  }

  toSnapshot(): AgentManifestDelegationSnapshot {
    return Object.freeze({
      mode: this.mode,
      allowedAgentTypes: this.allowedAgentTypes,
    });
  }
}

export interface AgentManifestOptions {
  readonly manifestId: string;
  readonly manifestDigest: AgentManifestDigest;
  readonly definition: AgentDefinition;
  readonly promptRecipe: ResolvedPromptRecipe;
  readonly compiledPrompt: AgentManifestPrompt;
  readonly tools: readonly AgentManifestTool[];
  readonly delegation: AgentManifestDelegation;
  readonly capabilityProfile?: ResolvedAgentCapabilities;
  readonly communicationRole: AgentCommunicationRole;
  readonly runtimePolicyId: string;
  readonly createdAt: string;
}

export interface AgentManifestSnapshot {
  readonly schemaVersion: typeof AGENT_MANIFEST_SCHEMA_VERSION;
  readonly manifestId: string;
  readonly manifestDigest: AgentManifestDigest;
  readonly definition: AgentDefinitionSnapshot;
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly promptRecipe: ResolvedPromptRecipeSnapshot;
  readonly compiledPrompt: AgentManifestPromptSnapshot;
  readonly tools: readonly AgentManifestToolSnapshot[];
  readonly delegation: AgentManifestDelegationSnapshot;
  readonly capabilityProfile: ResolvedAgentCapabilitiesSnapshot;
  readonly communicationRole: AgentCommunicationRole;
  readonly runtimePolicyId: string;
  readonly createdAt: string;
}

export class AgentManifest {
  readonly schemaVersion = AGENT_MANIFEST_SCHEMA_VERSION;
  readonly manifestId: string;
  readonly manifestDigest: AgentManifestDigest;
  readonly definition: AgentDefinitionSnapshot;
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly promptRecipe: ResolvedPromptRecipe;
  readonly compiledPrompt: AgentManifestPrompt;
  readonly tools: readonly AgentManifestTool[];
  readonly delegation: AgentManifestDelegation;
  readonly capabilityProfile: ResolvedAgentCapabilities;
  readonly communicationRole: AgentCommunicationRole;
  readonly runtimePolicyId: string;
  readonly createdAt: string;

  constructor(options: AgentManifestOptions) {
    this.manifestId = captureIdentity(options.manifestId, "Manifest ID");
    this.manifestDigest = captureManifestDigest(options.manifestDigest);
    if (!(options.definition instanceof AgentDefinition)) {
      throw new TypeError("Manifest Agent Definition is invalid");
    }
    if (!(options.promptRecipe instanceof ResolvedPromptRecipe)) {
      throw new TypeError("Manifest Prompt Recipe is invalid");
    }
    if (!(options.compiledPrompt instanceof AgentManifestPrompt)) {
      throw new TypeError("Manifest compiled Prompt is invalid");
    }
    if (!(options.delegation instanceof AgentManifestDelegation)) {
      throw new TypeError("Manifest delegation is invalid");
    }
    if (!isCommunicationRole(options.communicationRole)) {
      throw new TypeError("Manifest communication role is invalid");
    }
    if (!Array.isArray(options.tools)) {
      throw new TypeError("Manifest Tools are invalid");
    }
    const tools = options.tools.map((tool) => {
      if (!(tool instanceof AgentManifestTool)) {
        throw new TypeError("Manifest Tool is invalid");
      }
      return tool;
    });
    assertUniqueTools(tools);

    this.definition = options.definition.toSnapshot();
    this.agentType = captureAgentType(this.definition.agentType);
    this.definitionVersion = captureSemver(
      this.definition.definitionVersion,
      "Manifest Definition version",
    );
    this.promptRecipe = options.promptRecipe;
    this.compiledPrompt = options.compiledPrompt;
    this.tools = Object.freeze([...tools].sort(compareTools));
    this.delegation = options.delegation;
    this.capabilityProfile = options.capabilityProfile ??
      createLegacyResolvedAgentCapabilities(
        options.definition,
        options.promptRecipe.items
          .filter((item): item is ResolvedPromptSectionItem =>
            item instanceof ResolvedPromptSectionItem)
          .map((item) => item.sectionId),
      );
    this.communicationRole = options.communicationRole;
    this.runtimePolicyId = captureIdentity(
      options.runtimePolicyId,
      "Manifest Runtime policy ID",
    );
    this.createdAt = captureTimestamp(options.createdAt);
    assertDefinitionPolicyConsistency(this, options.definition);
    Object.freeze(this);
  }

  toSnapshot(): AgentManifestSnapshot {
    return Object.freeze({
      schemaVersion: this.schemaVersion,
      manifestId: this.manifestId,
      manifestDigest: this.manifestDigest,
      definition: this.definition,
      agentType: this.agentType,
      definitionVersion: this.definitionVersion,
      promptRecipe: this.promptRecipe.toSnapshot(),
      compiledPrompt: this.compiledPrompt.toSnapshot(),
      tools: Object.freeze(this.tools.map((tool) => tool.toSnapshot())),
      delegation: this.delegation.toSnapshot(),
      capabilityProfile: this.capabilityProfile.toSnapshot(),
      communicationRole: this.communicationRole,
      runtimePolicyId: this.runtimePolicyId,
      createdAt: this.createdAt,
    });
  }
}

function assertDefinitionPolicyConsistency(
  manifest: AgentManifest,
  definition: AgentDefinition,
): void {
  if (
    manifest.communicationRole !== definition.communication.role ||
    manifest.capabilityProfile.communicationRole !== definition.communication.role ||
    manifest.runtimePolicyId !== definition.runtimePolicyId ||
    manifest.delegation.mode !== definition.delegation.mode ||
    manifest.delegation.allowedAgentTypes.length !==
      definition.delegation.allowedAgentTypes.length ||
    manifest.delegation.allowedAgentTypes.some(
      (agentType, index) =>
        agentType !== definition.delegation.allowedAgentTypes[index],
    )
  ) {
    throw new TypeError("Agent Manifest policy does not match Definition");
  }
}

export function captureManifestDigest(value: unknown): AgentManifestDigest {
  return capturePromptDigest(value) as AgentManifestDigest;
}

function assertUniqueTools(tools: readonly AgentManifestTool[]): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new TypeError("Manifest Tools must be unique");
    }
    seen.add(tool.name);
  }
}

function compareTools(left: AgentManifestTool, right: AgentManifestTool): number {
  return left.name.localeCompare(right.name);
}

function captureIdentity(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function captureSemver(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function captureTimestamp(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError("Manifest createdAt is invalid");
  }
  return value;
}

function requireNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function isDelegationMode(value: unknown): value is AgentDelegationMode {
  return value === "disabled" || value === "subagent" || value === "agent_team";
}

function isCommunicationRole(value: unknown): value is AgentCommunicationRole {
  return value === "standalone" ||
    value === "orchestrator" ||
    value === "team_member" ||
    value === "ephemeral_subagent";
}
