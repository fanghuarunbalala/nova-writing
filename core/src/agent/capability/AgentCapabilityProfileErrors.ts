/** Stable provider-neutral failures for immutable Agent Capability Profile catalogs. */

export const AGENT_CAPABILITY_PROFILE_FAILURE = {
  duplicateProfile: "duplicate_profile",
  unknownProfile: "unknown_profile",
} as const;

export type AgentCapabilityProfileFailure =
  (typeof AGENT_CAPABILITY_PROFILE_FAILURE)[keyof typeof AGENT_CAPABILITY_PROFILE_FAILURE];

export class AgentCapabilityProfileError extends Error {
  override readonly name = "AgentCapabilityProfileError";

  constructor(
    readonly failure: AgentCapabilityProfileFailure,
    readonly profileId?: string,
    readonly version?: string,
  ) {
    super(`Agent Capability Profile failed (${failure})`);
  }
}
