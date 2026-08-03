/** Immutable in-memory Runtime configuration profiles selected by Manifest policy ID. */
import {
  AgentRuntimeExecutionLimits,
  AgentRuntimePolicyReferences,
} from "./AgentRuntimeConfiguration.js";
import type {
  AgentRuntimeConfigurationProfile,
  AgentRuntimeConfigurationProfileResolver,
} from "./AgentRuntimeConfigurationFactory.js";
import {
  AGENT_RUNTIME_BOOTSTRAP_FAILURE,
  AgentRuntimeBootstrapError,
} from "./AgentRuntimeConfigurationFactoryErrors.js";

export interface AgentRuntimeConfigurationProfileOptions {
  readonly policies: AgentRuntimePolicyReferences;
  readonly limits: AgentRuntimeExecutionLimits;
}

export class InMemoryAgentRuntimeConfigurationProfileResolver
  implements AgentRuntimeConfigurationProfileResolver
{
  readonly #profiles: ReadonlyMap<string, AgentRuntimeConfigurationProfile>;

  constructor(profiles: readonly AgentRuntimeConfigurationProfileOptions[]) {
    const captured = new Map<string, AgentRuntimeConfigurationProfile>();
    for (const profile of profiles) {
      if (!(profile.policies instanceof AgentRuntimePolicyReferences)) {
        throw new TypeError("Agent Runtime policy references are invalid");
      }
      if (!(profile.limits instanceof AgentRuntimeExecutionLimits)) {
        throw new TypeError("Agent Runtime execution limits are invalid");
      }
      if (captured.has(profile.policies.runtimePolicyId)) {
        throw new TypeError("Agent Runtime configuration profile is duplicated");
      }
      captured.set(
        profile.policies.runtimePolicyId,
        Object.freeze({ policies: profile.policies, limits: profile.limits }),
      );
    }
    this.#profiles = captured;
    Object.freeze(this);
  }

  async resolve(runtimePolicyId: string): Promise<AgentRuntimeConfigurationProfile> {
    const profile = this.#profiles.get(runtimePolicyId);
    if (!profile) {
      throw new AgentRuntimeBootstrapError(
        AGENT_RUNTIME_BOOTSTRAP_FAILURE.profileMissing,
      );
    }
    return profile;
  }
}
