/** Resolves role defaults with explicit Agent Definition capability policies. */
import {
  AgentDefinition,
  AgentToolPolicy,
} from "../definition/AgentDefinition.js";
import { PromptSectionItem } from "../../prompt/PromptPlanItem.js";
import type { PromptSectionRegistry } from "../../prompt/section/PromptSectionRegistry.js";
import type { ToolGroupCatalog } from "../../tooling/group/ToolGroupCatalog.js";
import { AgentCapabilityProfileCatalog } from "./AgentCapabilityProfileCatalog.js";
import {
  AGENT_CAPABILITY_PROFILE_FAILURE,
  AgentCapabilityProfileError,
} from "./AgentCapabilityProfileErrors.js";
import { ResolvedAgentCapabilities } from "./ResolvedAgentCapabilities.js";

export interface AgentCapabilityProfileResolverOptions {
  readonly profiles: AgentCapabilityProfileCatalog;
  readonly promptSections: PromptSectionRegistry;
  readonly toolGroups: ToolGroupCatalog;
}

export interface AgentCapabilityProfileResolutionRequest {
  readonly definition: AgentDefinition;
  readonly profileId?: string;
  readonly profileVersion?: string;
}

export class AgentCapabilityProfileResolver {
  readonly #profiles: AgentCapabilityProfileCatalog;
  readonly #promptSections: PromptSectionRegistry;
  readonly #toolGroups: ToolGroupCatalog;

  constructor(options: AgentCapabilityProfileResolverOptions) {
    if (!(options.profiles instanceof AgentCapabilityProfileCatalog)) {
      throw new TypeError("Agent Capability Profile Catalog is invalid");
    }
    this.#profiles = options.profiles;
    this.#promptSections = options.promptSections;
    this.#toolGroups = options.toolGroups;
  }

  async resolve(
    request: AgentCapabilityProfileResolutionRequest,
  ): Promise<ResolvedAgentCapabilities> {
    if (!(request.definition instanceof AgentDefinition)) {
      throw new TypeError("Agent Definition is invalid");
    }
    const profileId = request.profileId ??
      `communication.${request.definition.communication.role}`;
    const profile = this.#profiles.resolve(profileId, request.profileVersion);
    if (profile.communicationRole !== request.definition.communication.role) {
      throw new AgentCapabilityProfileError(
        AGENT_CAPABILITY_PROFILE_FAILURE.communicationRoleMismatch,
        profile.profileId,
        profile.version,
      );
    }

    const promptSectionIds = mergeUnique(
      profile.defaultPromptSectionIds,
      request.definition.promptRecipe.items
        .filter((item): item is PromptSectionItem => item instanceof PromptSectionItem)
        .map((item) => item.sectionId),
    );
    for (const sectionId of promptSectionIds) {
      try {
        this.#promptSections.resolve(sectionId);
      } catch {
        throw new AgentCapabilityProfileError(
          AGENT_CAPABILITY_PROFILE_FAILURE.unknownPromptSection,
          sectionId,
        );
      }
    }

    const toolGroupIds = mergeUnique(
      profile.defaultToolGroupIds,
      request.definition.tools.groupIds,
    );
    for (const groupId of toolGroupIds) {
      if (!this.#toolGroups.has(groupId)) {
        throw new AgentCapabilityProfileError(
          AGENT_CAPABILITY_PROFILE_FAILURE.unknownToolGroup,
          groupId,
        );
      }
    }

    return new ResolvedAgentCapabilities({
      profile,
      promptSectionIds,
      toolPolicy: new AgentToolPolicy({
        groupIds: toolGroupIds,
        allow: request.definition.tools.allow,
        deny: request.definition.tools.deny,
      }),
      channelIds: profile.defaultChannelIds,
    });
  }
}

function mergeUnique(
  ...groups: readonly (readonly string[])[]
): readonly string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const group of groups) {
    for (const value of group) {
      if (!seen.has(value)) {
        seen.add(value);
        merged.push(value);
      }
    }
  }
  return Object.freeze(merged);
}
