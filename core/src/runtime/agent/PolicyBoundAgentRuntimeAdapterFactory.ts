/** Resolves policy-scoped services before creating a concrete Provider adapter. */
import type { AgentRuntimeAdapterFactory } from "./AgentRuntimeExecutionAssembly.js";
import type { AgentRuntimeConfiguration } from "./AgentRuntimeConfiguration.js";
import type {
  AgentRuntimePolicyServicesResolver,
  PolicyAwareAgentRuntimeAdapterFactory,
} from "./AgentRuntimePolicyServices.js";

export interface PolicyBoundAgentRuntimeAdapterFactoryOptions {
  readonly services: AgentRuntimePolicyServicesResolver;
  readonly delegate: PolicyAwareAgentRuntimeAdapterFactory;
}

export class PolicyBoundAgentRuntimeAdapterFactory
  implements AgentRuntimeAdapterFactory
{
  readonly #services: AgentRuntimePolicyServicesResolver;
  readonly #delegate: PolicyAwareAgentRuntimeAdapterFactory;

  constructor(options: PolicyBoundAgentRuntimeAdapterFactoryOptions) {
    this.#services = options.services;
    this.#delegate = options.delegate;
  }

  async create(configuration: AgentRuntimeConfiguration) {
    const services = await this.#services.resolve(configuration);
    return this.#delegate.create(configuration, services);
  }
}
