/** Policy-scoped Runtime services injected into a concrete Agent adapter factory. */
import type {
  ContextCheckpointApplicationCoordinator,
  ContextProjectionProviderCallCoordinator,
} from "../context/index.js";
import type { NudgeProviderCallCoordinator } from "../nudge/index.js";
import type { RuntimePolicyEngine } from "../policy/index.js";
import type { AgentRuntimeConfiguration } from "./AgentRuntimeConfiguration.js";
import type { AgentRuntimeAdapter } from "./AgentRuntimeAdapter.js";

export interface AgentRuntimePolicyServicesOptions {
  readonly runtimePolicyEngine: RuntimePolicyEngine;
  readonly contextProjectionProviderCalls?: ContextProjectionProviderCallCoordinator;
  readonly checkpointApplications?: ContextCheckpointApplicationCoordinator;
  readonly nudgeProviderCalls?: NudgeProviderCallCoordinator;
}

export class AgentRuntimePolicyServices {
  readonly runtimePolicyEngine: RuntimePolicyEngine;
  readonly contextProjectionProviderCalls?: ContextProjectionProviderCallCoordinator;
  readonly checkpointApplications?: ContextCheckpointApplicationCoordinator;
  readonly nudgeProviderCalls?: NudgeProviderCallCoordinator;

  constructor(options: AgentRuntimePolicyServicesOptions) {
    this.runtimePolicyEngine = options.runtimePolicyEngine;
    this.contextProjectionProviderCalls = options.contextProjectionProviderCalls;
    this.checkpointApplications = options.checkpointApplications;
    this.nudgeProviderCalls = options.nudgeProviderCalls;
    Object.freeze(this);
  }
}

export interface AgentRuntimePolicyServicesResolver {
  resolve(configuration: AgentRuntimeConfiguration): Promise<AgentRuntimePolicyServices>;
}

export interface PolicyAwareAgentRuntimeAdapterFactory {
  create(
    configuration: AgentRuntimeConfiguration,
    services: AgentRuntimePolicyServices,
  ): Promise<AgentRuntimeAdapter>;
}
