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

/**
 * 一个 agent 显式启用的 nudge 列表（nudgeId），随 AgentDefinition 持久化。
 * 装配侧以 `definition.nudgeEnablement.enabled` ∩ 工具组守卫过滤生效集。
 * Nudges an agent explicitly enables (nudgeIds), persisted with the
 * AgentDefinition. The assembly side filters the effective set as
 * `definition.nudgeEnablement.enabled` ∩ tool-group guard.
 */
export interface AgentNudgeEnablement {
  /** 显式启用的 nudgeId；未启用的 nudge 在装配侧不注入。Enabled nudgeIds; unlisted nudges are not injected at assembly. */
  readonly enabled: readonly string[];
}

/** 未配置 nudge 启用时的默认空集。Default empty set when no nudge enablement is configured. */
export const EMPTY_AGENT_NUDGE_ENABLEMENT: AgentNudgeEnablement =
  Object.freeze({
    enabled: Object.freeze([]),
  });

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
  /** 显式启用的 nudge；缺省为空集。Explicitly enabled nudges; defaults to the empty set. */
  readonly nudgeEnablement?: AgentNudgeEnablement;
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
  readonly nudgeEnablement: AgentNudgeEnablement;
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
  readonly nudgeEnablement: AgentNudgeEnablement;

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
    this.nudgeEnablement = captureNudgeEnablement(options.nudgeEnablement);
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
      nudgeEnablement: this.nudgeEnablement,
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

/** 捕获 nudge 启用配置；缺省/空数组 → 空集，逐项校验唯一性。Captures nudge enablement; absent/empty → empty set, per-item uniqueness enforced. */
function captureNudgeEnablement(value: unknown): AgentNudgeEnablement {
  if (value === undefined) return EMPTY_AGENT_NUDGE_ENABLEMENT;
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Agent Nudge enablement is invalid");
  }
  const enabled = (value as { enabled?: unknown }).enabled;
  if (enabled === undefined) return EMPTY_AGENT_NUDGE_ENABLEMENT;
  if (!Array.isArray(enabled)) {
    throw new TypeError("Agent Nudge enablements are invalid");
  }
  const seen = new Set<string>();
  return Object.freeze({
    enabled: Object.freeze(
      enabled.map((identity) => {
        const captured = captureIdentity(identity, "Agent Nudge");
        if (seen.has(captured)) {
          throw new TypeError("Agent Nudge enablements must be unique");
        }
        seen.add(captured);
        return captured;
      }),
    ),
  });
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
