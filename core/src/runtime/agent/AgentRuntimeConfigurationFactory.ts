/** Restores a manifest-bound Runtime configuration from a Conversation Bootstrap. */
import type {
  AgentAssemblyRestorer,
  AgentManifest,
  AgentManifestStore,
} from "../../agent/manifest/index.js";
import type { ConversationRuntimeBootstrap } from "../../conversation/host/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  AgentRuntimeConfiguration,
  AgentRuntimeExecutionLimits,
  AgentRuntimePolicyReferences,
} from "./AgentRuntimeConfiguration.js";
import {
  AGENT_RUNTIME_BOOTSTRAP_FAILURE,
  AgentRuntimeBootstrapError,
} from "./AgentRuntimeConfigurationFactoryErrors.js";

export interface AgentRuntimeConfigurationProfile {
  readonly policies: AgentRuntimePolicyReferences;
  readonly limits: AgentRuntimeExecutionLimits;
}

export interface AgentRuntimeConfigurationProfileResolver {
  resolve(runtimePolicyId: string): Promise<AgentRuntimeConfigurationProfile>;
}

export interface AgentRuntimeConfigurationFactoryOptions {
  readonly manifestStore: AgentManifestStore;
  readonly assemblyRestorer: AgentAssemblyRestorer;
  readonly profileResolver: AgentRuntimeConfigurationProfileResolver;
  readonly logger?: Logger;
}

export class AgentRuntimeConfigurationFactory {
  readonly #manifestStore: AgentManifestStore;
  readonly #assemblyRestorer: AgentAssemblyRestorer;
  readonly #profileResolver: AgentRuntimeConfigurationProfileResolver;
  readonly #logger: Logger;

  constructor(options: AgentRuntimeConfigurationFactoryOptions) {
    this.#manifestStore = options.manifestStore;
    this.#assemblyRestorer = options.assemblyRestorer;
    this.#profileResolver = options.profileResolver;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "agent_runtime_configuration_factory",
    });
  }

  async create(
    bootstrap: ConversationRuntimeBootstrap,
  ): Promise<AgentRuntimeConfiguration> {
    const binding = bootstrap.conversation.activeAgentBinding;
    this.#logger.debug("agent_runtime.configuration_restore_started", {
      conversationId: bootstrap.conversation.metadata.id,
      agentType: binding.agentType,
      definitionVersion: binding.definitionVersion,
    });
    if (binding.manifestId === undefined || binding.manifestDigest === undefined) {
      throw new AgentRuntimeBootstrapError(
        AGENT_RUNTIME_BOOTSTRAP_FAILURE.manifestBindingMissing,
      );
    }
    const manifest = await this.#manifestStore.get(binding.manifestId);
    assertManifestMatchesBinding(manifest, binding);
    const profile = await this.#profileResolver.resolve(manifest.runtimePolicyId);
    const configuration = new AgentRuntimeConfiguration({
      conversationId: bootstrap.conversation.metadata.id,
      assembly: this.#assemblyRestorer.restore(manifest),
      policies: profile.policies,
      limits: profile.limits,
    });
    this.#logger.info("agent_runtime.configuration_restore_completed", {
      conversationId: configuration.conversationId,
      agentType: configuration.assembly.agentType,
      definitionVersion: configuration.assembly.definitionVersion,
      manifestDigest: configuration.assembly.manifest.manifestDigest,
    });
    return configuration;
  }
}

function assertManifestMatchesBinding(
  manifest: AgentManifest | undefined,
  binding: ConversationRuntimeBootstrap["conversation"]["activeAgentBinding"],
): asserts manifest is AgentManifest {
  if (manifest === undefined) {
    throw new AgentRuntimeBootstrapError(
      AGENT_RUNTIME_BOOTSTRAP_FAILURE.manifestMissing,
    );
  }
  if (
    manifest.manifestDigest !== binding.manifestDigest ||
    manifest.agentType !== binding.agentType ||
    manifest.definitionVersion !== binding.definitionVersion
  ) {
    throw new AgentRuntimeBootstrapError(
      AGENT_RUNTIME_BOOTSTRAP_FAILURE.manifestMismatch,
    );
  }
}
