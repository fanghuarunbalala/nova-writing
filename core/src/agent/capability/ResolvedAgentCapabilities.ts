/** Immutable Agent capability resolution result used before Manifest assembly. */
import type { AgentCommunicationRole } from "../definition/AgentDefinition.js";
import { AgentToolPolicy } from "../definition/AgentDefinition.js";
import { AgentCapabilityProfile } from "./AgentCapabilityProfile.js";

export const RESOLVED_AGENT_CAPABILITIES_SCHEMA_VERSION = 1 as const;

export interface ResolvedAgentCapabilitiesSnapshot {
  readonly schemaVersion: typeof RESOLVED_AGENT_CAPABILITIES_SCHEMA_VERSION;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly communicationRole: AgentCommunicationRole;
  readonly promptSectionIds: readonly string[];
  readonly toolPolicy: {
    readonly groupIds: readonly string[];
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
  };
  readonly channelIds: readonly string[];
}

export interface ResolvedAgentCapabilitiesOptions {
  readonly profile: AgentCapabilityProfile;
  readonly promptSectionIds: readonly string[];
  readonly toolPolicy: AgentToolPolicy;
  readonly channelIds: readonly string[];
}

export class ResolvedAgentCapabilities {
  readonly schemaVersion = RESOLVED_AGENT_CAPABILITIES_SCHEMA_VERSION;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly communicationRole: AgentCommunicationRole;
  readonly promptSectionIds: readonly string[];
  readonly toolPolicy: AgentToolPolicy;
  readonly channelIds: readonly string[];

  constructor(options: ResolvedAgentCapabilitiesOptions) {
    if (!(options.profile instanceof AgentCapabilityProfile)) {
      throw new TypeError("Resolved Capability Profile is invalid");
    }
    if (!Array.isArray(options.promptSectionIds)) {
      throw new TypeError("Resolved Prompt Section IDs are invalid");
    }
    if (!(options.toolPolicy instanceof AgentToolPolicy)) {
      throw new TypeError("Resolved Tool policy is invalid");
    }
    if (!Array.isArray(options.channelIds)) {
      throw new TypeError("Resolved communication Channel IDs are invalid");
    }
    this.profileId = options.profile.profileId;
    this.profileVersion = options.profile.version;
    this.communicationRole = options.profile.communicationRole;
    this.promptSectionIds = Object.freeze([...options.promptSectionIds]);
    this.toolPolicy = options.toolPolicy;
    this.channelIds = Object.freeze([...options.channelIds]);
    Object.freeze(this);
  }

  toSnapshot(): ResolvedAgentCapabilitiesSnapshot {
    return Object.freeze({
      schemaVersion: this.schemaVersion,
      profileId: this.profileId,
      profileVersion: this.profileVersion,
      communicationRole: this.communicationRole,
      promptSectionIds: this.promptSectionIds,
      toolPolicy: this.toolPolicy.toSnapshot(),
      channelIds: this.channelIds,
    });
  }
}
