/** Immutable, deterministic lookup of versioned Agent Capability Profiles. */
import { AgentCapabilityProfile } from "./AgentCapabilityProfile.js";
import {
  AGENT_CAPABILITY_PROFILE_FAILURE,
  AgentCapabilityProfileError,
} from "./AgentCapabilityProfileErrors.js";

export class AgentCapabilityProfileCatalog {
  readonly #profiles: ReadonlyMap<
    string,
    ReadonlyMap<string, AgentCapabilityProfile>
  >;
  readonly #ordered: readonly AgentCapabilityProfile[];

  constructor(profiles: readonly AgentCapabilityProfile[]) {
    if (!Array.isArray(profiles)) {
      throw new TypeError("Agent Capability Profiles are invalid");
    }
    const byId = new Map<string, Map<string, AgentCapabilityProfile>>();
    for (const profile of profiles) {
      if (!(profile instanceof AgentCapabilityProfile)) {
        throw new TypeError("Agent Capability Profile is invalid");
      }
      const versions = byId.get(profile.profileId) ??
        new Map<string, AgentCapabilityProfile>();
      if (versions.has(profile.version)) {
        throw new AgentCapabilityProfileError(
          AGENT_CAPABILITY_PROFILE_FAILURE.duplicateProfile,
          profile.profileId,
          profile.version,
        );
      }
      versions.set(profile.version, profile);
      byId.set(profile.profileId, versions);
    }
    this.#profiles = new Map(
      [...byId].map(([profileId, versions]) => [
        profileId,
        new Map(versions),
      ]),
    );
    this.#ordered = Object.freeze(
      [...byId.values()]
        .flatMap((versions) => [...versions.values()])
        .sort(compareProfiles),
    );
    Object.freeze(this);
  }

  resolve(profileId: string, requestedVersion?: string): AgentCapabilityProfile {
    const versions = this.#profiles.get(profileId);
    if (!versions) {
      throw new AgentCapabilityProfileError(
        AGENT_CAPABILITY_PROFILE_FAILURE.unknownProfile,
        profileId,
        requestedVersion,
      );
    }
    if (requestedVersion !== undefined) {
      const profile = versions.get(requestedVersion);
      if (!profile) {
        throw new AgentCapabilityProfileError(
          AGENT_CAPABILITY_PROFILE_FAILURE.unknownProfile,
          profileId,
          requestedVersion,
        );
      }
      return profile;
    }
    return [...versions.values()].sort(compareVersions).at(-1)!;
  }

  list(): readonly AgentCapabilityProfile[] {
    return this.#ordered;
  }
}

function compareProfiles(
  left: AgentCapabilityProfile,
  right: AgentCapabilityProfile,
): number {
  return left.profileId === right.profileId
    ? compareVersions(left, right)
    : left.profileId.localeCompare(right.profileId);
}

function compareVersions(
  left: AgentCapabilityProfile,
  right: AgentCapabilityProfile,
): number {
  const leftParts = left.version.split(".").map(Number);
  const rightParts = right.version.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}
