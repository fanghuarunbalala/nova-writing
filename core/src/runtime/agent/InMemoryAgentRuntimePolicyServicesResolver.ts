/** Immutable policy-ID resolver for Runtime Policy, Context, and Nudge services. */
import type { AgentRuntimeConfiguration } from "./AgentRuntimeConfiguration.js";
import {
  AgentRuntimePolicyServices,
  type AgentRuntimePolicyServicesResolver,
} from "./AgentRuntimePolicyServices.js";
import {
  AGENT_RUNTIME_POLICY_SERVICES_FAILURE,
  AgentRuntimePolicyServicesError,
} from "./AgentRuntimePolicyServicesErrors.js";

export interface AgentRuntimePolicyServicesProfile {
  readonly runtimePolicyId: string;
  readonly contextPolicyId: string;
  readonly nudgePolicyId: string;
  readonly services: AgentRuntimePolicyServices;
}

export class InMemoryAgentRuntimePolicyServicesResolver
  implements AgentRuntimePolicyServicesResolver
{
  readonly #profiles: ReadonlyMap<string, AgentRuntimePolicyServices>;

  constructor(profiles: readonly AgentRuntimePolicyServicesProfile[]) {
    const captured = new Map<string, AgentRuntimePolicyServices>();
    for (const profile of profiles) {
      if (!(profile.services instanceof AgentRuntimePolicyServices)) {
        throw new TypeError("Agent Runtime policy services are invalid");
      }
      const key = profileKey(
        profile.runtimePolicyId,
        profile.contextPolicyId,
        profile.nudgePolicyId,
      );
      if (captured.has(key)) {
        throw new TypeError("Agent Runtime policy services profile is duplicated");
      }
      captured.set(key, profile.services);
    }
    this.#profiles = captured;
    Object.freeze(this);
  }

  async resolve(
    configuration: AgentRuntimeConfiguration,
  ): Promise<AgentRuntimePolicyServices> {
    const policies = configuration.policies;
    const services = this.#profiles.get(profileKey(
      policies.runtimePolicyId,
      policies.contextPolicyId,
      policies.nudgePolicyId,
    ));
    if (!services) {
      throw new AgentRuntimePolicyServicesError(
        AGENT_RUNTIME_POLICY_SERVICES_FAILURE.profileMissing,
      );
    }
    return services;
  }
}

function profileKey(
  runtimePolicyId: string,
  contextPolicyId: string,
  nudgePolicyId: string,
): string {
  return `${runtimePolicyId}\u0000${contextPolicyId}\u0000${nudgePolicyId}`;
}
