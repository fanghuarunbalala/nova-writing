/** Immutable Agent Definition value objects controlling Prompt, Tool, and delegation policy. */
import { PromptRecipe } from "../../prompt/PromptRecipe.js";
import type { PromptRecipeSnapshot } from "../../prompt/PromptRecipe.js";

export const AGENT_DEFINITION_SCHEMA_VERSION = 1 as const;

export type AgentCommunicationRole =
  | "standalone"
  | "orchestrator"
  | "team_member"
  | "ephemeral_subagent";

export type AgentDelegationMode = "disabled" | "subagent" | "agent_team";

export interface AgentToolPolicySnapshot {
  readonly groupIds: readonly string[];
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

export class AgentToolPolicy {
  readonly groupIds: readonly string[];
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];

  constructor(options: AgentToolPolicySnapshot) {
    this.groupIds = captureUniqueIdentities(options.groupIds, "Tool Group");
    this.allow = captureOptionalUniqueIdentities(options.allow, "allowed Tool");
    this.deny = captureOptionalUniqueIdentities(options.deny, "denied Tool");
    Object.freeze(this);
  }

  toSnapshot(): AgentToolPolicySnapshot {
    return Object.freeze({
      groupIds: this.groupIds,
      ...(this.allow === undefined ? {} : { allow: this.allow }),
      ...(this.deny === undefined ? {} : { deny: this.deny }),
    });
  }
}

export interface AgentDelegationPolicySnapshot {
  readonly mode: AgentDelegationMode;
  readonly allowedAgentTypes: readonly string[];
}

export class AgentDelegationPolicy {
  readonly mode: AgentDelegationMode;
  readonly allowedAgentTypes: readonly string[];

  constructor(options: AgentDelegationPolicySnapshot) {
    if (!isDelegationMode(options.mode)) {
      throw new TypeError("Agent delegation mode is invalid");
    }
    this.mode = options.mode;
    this.allowedAgentTypes = captureUniqueAgentTypes(options.allowedAgentTypes);
    if (this.mode === "disabled" && this.allowedAgentTypes.length > 0) {
      throw new TypeError("Disabled Agent delegation cannot allow Agent types");
    }
    Object.freeze(this);
  }

  toSnapshot(): AgentDelegationPolicySnapshot {
    return Object.freeze({
      mode: this.mode,
      allowedAgentTypes: this.allowedAgentTypes,
    });
  }
}

export class AgentCommunicationPolicy {
  readonly role: AgentCommunicationRole;

  constructor(role: AgentCommunicationRole) {
    if (!isCommunicationRole(role)) {
      throw new TypeError("Agent communication role is invalid");
    }
    this.role = role;
    Object.freeze(this);
  }
}

export interface AgentDefinitionOptions {
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly label: string;
  readonly description: string;
  readonly promptRecipe: PromptRecipe;
  readonly tools: AgentToolPolicy;
  readonly delegation: AgentDelegationPolicy;
  readonly communication: AgentCommunicationPolicy;
  readonly runtimePolicyId: string;
}

export interface AgentDefinitionSnapshot {
  readonly schemaVersion: typeof AGENT_DEFINITION_SCHEMA_VERSION;
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly label: string;
  readonly description: string;
  readonly promptRecipe: PromptRecipeSnapshot;
  readonly tools: AgentToolPolicySnapshot;
  readonly delegation: AgentDelegationPolicySnapshot;
  readonly communication: { readonly role: AgentCommunicationRole };
  readonly runtimePolicyId: string;
}

export class AgentDefinition {
  readonly schemaVersion = AGENT_DEFINITION_SCHEMA_VERSION;
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly label: string;
  readonly description: string;
  readonly promptRecipe: PromptRecipe;
  readonly tools: AgentToolPolicy;
  readonly delegation: AgentDelegationPolicy;
  readonly communication: AgentCommunicationPolicy;
  readonly runtimePolicyId: string;

  constructor(options: AgentDefinitionOptions) {
    this.agentType = captureAgentType(options.agentType);
    this.definitionVersion = captureVersion(options.definitionVersion);
    this.label = requireNonBlank(options.label, "Agent label");
    this.description = requireNonBlank(options.description, "Agent description");
    if (!(options.promptRecipe instanceof PromptRecipe)) {
      throw new TypeError("Agent Prompt Recipe is invalid");
    }
    if (!(options.tools instanceof AgentToolPolicy)) {
      throw new TypeError("Agent Tool policy is invalid");
    }
    if (!(options.delegation instanceof AgentDelegationPolicy)) {
      throw new TypeError("Agent delegation policy is invalid");
    }
    if (!(options.communication instanceof AgentCommunicationPolicy)) {
      throw new TypeError("Agent communication policy is invalid");
    }
    this.promptRecipe = options.promptRecipe;
    this.tools = options.tools;
    this.delegation = options.delegation;
    this.communication = options.communication;
    this.runtimePolicyId = captureIdentity(
      options.runtimePolicyId,
      "Runtime policy ID",
    );
    Object.freeze(this);
  }

  toSnapshot(): AgentDefinitionSnapshot {
    return Object.freeze({
      schemaVersion: this.schemaVersion,
      agentType: this.agentType,
      definitionVersion: this.definitionVersion,
      label: this.label,
      description: this.description,
      promptRecipe: this.promptRecipe.toSnapshot(),
      tools: this.tools.toSnapshot(),
      delegation: this.delegation.toSnapshot(),
      communication: Object.freeze({ role: this.communication.role }),
      runtimePolicyId: this.runtimePolicyId,
    });
  }
}

export function captureAgentType(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) {
    throw new TypeError("Agent type is invalid");
  }
  return value;
}

function captureUniqueAgentTypes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError("Allowed Agent types are invalid");
  const seen = new Set<string>();
  return Object.freeze(value.map((agentType) => {
    const captured = captureAgentType(agentType);
    if (seen.has(captured)) throw new TypeError("Allowed Agent types must be unique");
    seen.add(captured);
    return captured;
  }));
}

function captureUniqueIdentities(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} identities are invalid`);
  }
  const seen = new Set<string>();
  return Object.freeze(value.map((identity) => {
    const captured = captureIdentity(identity, label);
    if (seen.has(captured)) throw new TypeError(`${label} identities must be unique`);
    seen.add(captured);
    return captured;
  }));
}

function captureOptionalUniqueIdentities(
  value: unknown,
  label: string,
): readonly string[] | undefined {
  return value === undefined ? undefined : captureUniqueIdentities(value, label);
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

function captureVersion(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  ) {
    throw new TypeError("Agent Definition version is invalid");
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
