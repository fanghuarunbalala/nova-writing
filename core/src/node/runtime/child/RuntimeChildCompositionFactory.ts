/** Child-local Runtime construction Port; Provider credentials stay behind it. */
import type {
  ConversationRuntimeBootstrap,
  ConversationRuntimeExit,
  ConversationRuntimeHandleShutdownRequest,
  ConversationRuntimeInputReference,
} from "../../../conversation/host/index.js";
import type { RuntimeBootstrapStartupResult } from "../../../runtime/execution/index.js";
import type {
  AgentRuntimeExecutionAssembly,
  AgentRuntimeExecutionAssembler,
  AgentRuntimeConfigurationFactory,
} from "../../../runtime/agent/index.js";
import type { AgentManifestStore } from "../../../agent/index.js";
import type { RuntimePersistencePorts } from "../../../runtime/ipc/index.js";
import type { SubagentBindingStore } from "../../../runtime/subagent/index.js";
import type { ConversationCatalogStore } from "../../../storage/index.js";
import type { RuntimeSubagentRpcRequester } from "../subagent/index.js";

/**
 * Child 组合根可访问的 Workspace 存储视图：manifest、conversations 与子代理绑定。
 * Child-composition-readable Workspace store view.
 */
export interface ChildRuntimeWorkspaceStore {
  readonly agentManifests: AgentManifestStore;
  readonly conversations: ConversationCatalogStore;
  createSubagentBindingStore(): SubagentBindingStore;
}

export type ChildRuntimeWorkspaceStoreProvider = (
  bootstrap: ConversationRuntimeBootstrap,
) => Promise<ChildRuntimeWorkspaceStore>;

export interface RuntimeChildRuntime {
  readonly conversationId: string;
  readonly runtimeInstanceId: string;

  start(bootstrap: ConversationRuntimeBootstrap): Promise<RuntimeBootstrapStartupResult>;

  dispatchInput(input: ConversationRuntimeInputReference): Promise<void>;

  shutdown(request: ConversationRuntimeHandleShutdownRequest): Promise<void>;

  waitForExit(): Promise<ConversationRuntimeExit>;
}

export interface RuntimeChildCompositionFactory {
  create(
    bootstrap: ConversationRuntimeBootstrap,
    context: RuntimeChildCompositionContext,
  ): Promise<RuntimeChildRuntime>;
}

export interface RuntimeChildCompositionContext {
  readonly persistence: RuntimePersistencePorts;
  readonly requester: RuntimeSubagentRpcRequester;
  readonly executionAssembly?: AgentRuntimeExecutionAssembly;
}

export interface ManifestBackedRuntimeChildCompositionFactoryOptions {
  readonly configurationFactory: AgentRuntimeConfigurationFactory;
  readonly executionAssembler: AgentRuntimeExecutionAssembler;
  readonly delegate: RuntimeChildCompositionFactory;
}

/** Restores Manifest-bound execution before delegating to a Child Runtime factory. */
export class ManifestBackedRuntimeChildCompositionFactory
  implements RuntimeChildCompositionFactory
{
  constructor(
    private readonly options: ManifestBackedRuntimeChildCompositionFactoryOptions,
  ) {}

  async create(
    bootstrap: ConversationRuntimeBootstrap,
    context: RuntimeChildCompositionContext,
  ): Promise<RuntimeChildRuntime> {
    const configuration = await this.options.configurationFactory.create(bootstrap);
    const executionAssembly = await this.options.executionAssembler.assemble(
      configuration,
    );
    return this.options.delegate.create(bootstrap, {
      ...context,
      executionAssembly,
    });
  }
}
