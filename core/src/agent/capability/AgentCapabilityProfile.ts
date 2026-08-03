/** Immutable default Prompt, Tool, and communication capabilities for one Agent role. */
import type { AgentCommunicationRole } from "../definition/AgentDefinition.js";

export const AGENT_CAPABILITY_PROFILE_SCHEMA_VERSION = 1 as const;

export interface AgentCapabilityProfileSnapshot {
  readonly schemaVersion: typeof AGENT_CAPABILITY_PROFILE_SCHEMA_VERSION;
  readonly profileId: string;
  readonly version: string;
  readonly communicationRole: AgentCommunicationRole;
  readonly defaultPromptSectionIds: readonly string[];
  readonly defaultToolGroupIds: readonly string[];
  readonly defaultChannelIds: readonly string[];
}

export interface AgentCapabilityProfileOptions {
  readonly profileId: string;
  readonly version: string;
  readonly communicationRole: AgentCommunicationRole;
  readonly defaultPromptSectionIds?: readonly string[];
  readonly defaultToolGroupIds?: readonly string[];
  readonly defaultChannelIds?: readonly string[];
}

export class AgentCapabilityProfile {
  readonly schemaVersion = AGENT_CAPABILITY_PROFILE_SCHEMA_VERSION;
  readonly profileId: string;
  readonly version: string;
  readonly communicationRole: AgentCommunicationRole;
  readonly defaultPromptSectionIds: readonly string[];
  readonly defaultToolGroupIds: readonly string[];
  readonly defaultChannelIds: readonly string[];

  constructor(options: AgentCapabilityProfileOptions) {
    this.profileId = captureIdentity(options.profileId, "Capability Profile ID");
    this.version = captureVersion(options.version);
    if (!isCommunicationRole(options.communicationRole)) {
      throw new TypeError("Capability Profile communication role is invalid");
    }
    this.communicationRole = options.communicationRole;
    this.defaultPromptSectionIds = captureUniqueIdentities(
      options.defaultPromptSectionIds ?? [],
      "default Prompt Section",
    );
    this.defaultToolGroupIds = captureUniqueIdentities(
      options.defaultToolGroupIds ?? [],
      "default Tool Group",
    );
    this.defaultChannelIds = captureUniqueIdentities(
      options.defaultChannelIds ?? [],
      "default communication Channel",
    );
    Object.freeze(this);
  }

  toSnapshot(): AgentCapabilityProfileSnapshot {
    return Object.freeze({
      schemaVersion: this.schemaVersion,
      profileId: this.profileId,
      version: this.version,
      communicationRole: this.communicationRole,
      defaultPromptSectionIds: this.defaultPromptSectionIds,
      defaultToolGroupIds: this.defaultToolGroupIds,
      defaultChannelIds: this.defaultChannelIds,
    });
  }
}

function isCommunicationRole(value: unknown): value is AgentCommunicationRole {
  return value === "standalone" ||
    value === "orchestrator" ||
    value === "team_member" ||
    value === "ephemeral_subagent";
}

function captureUniqueIdentities(
  value: readonly string[],
  label: string,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} identities are invalid`);
  }
  const seen = new Set<string>();
  const captured = value.map((identity) => {
    const result = captureIdentity(identity, label);
    if (seen.has(result)) {
      throw new TypeError(`${label} identities must be unique`);
    }
    seen.add(result);
    return result;
  });
  return Object.freeze(captured);
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
    throw new TypeError("Capability Profile version is invalid");
  }
  return value;
}
