/**
 * Desktop child Runtime composition root: opens the child-accessible Manifest
 * Store, restores the Manifest-bound Agent configuration, builds the Pi
 * adapter with the live Turn lifecycle, and composes the full Conversation
 * Runtime while persistence stays behind the Runtime persistence RPC.
 */
import type {
  ConversationRuntimeBootstrap,
  ConversationRuntimeExit,
  ConversationRuntimeHandleShutdownRequest,
  ConversationRuntimeInputReference,
  ConversationOutputEventPublisher,
  ConversationRuntimePresenceReader,
  OutputReceipt,
} from "../../../conversation/index.js";
import { CONVERSATION_RUNTIME_SHUTDOWN_REASON } from "../../../conversation/host/index.js";
import type { OutputEvent } from "../../../event/index.js";
import type {
  ConversationCatalogStore,
  ConversationEventPage,
  ConversationEventQuery,
  ConversationJournalReader,
  PersistedConversationEventSnapshot,
} from "../../../storage/index.js";
import {
  AgentAssembler,
  AgentAssemblyRestorer,
  AgentDefinitionCatalog,
  AgentManifestResolver,
  novelAgentDefinition,
  novelComposeAgentDefinition,
  novelExplorerAgentDefinition,
  resolveAgentNudgeEnablements,
  type AgentManifestIdFactory,
  type AgentManifestStore,
} from "../../../agent/index.js";
import {
  ManifestSystemPromptCompiler,
  PromptCapabilitySnapshot,
  createDefaultPromptSectionRegistry,
  type PromptDigester,
} from "../../../prompt/index.js";
import {
  CatalogHostChildConversationAdapter,
  DefaultChildConversationManager,
  DefaultSubagentLifecycleCoordinator,
  DurableChildConversationManager,
  NOVEL_SUBAGENT_TOOL_COMPOSITION_POLICY,
  SUBAGENT_CANCELLATION_REASON,
  SUBAGENT_SCHEMA_VERSION,
  SUBAGENT_TASK_CANCELLATION_STATUS,
  SubagentCompletionBridge,
  SubagentCompletionObserver,
  SubagentTaskQueryService,
  createProductionSubagentDefinitionCatalog,
  type ChildConversationIdFactory,
  type ChildConversationManagerClock,
  type SubagentBinding,
  type SubagentBindingStore,
  type SubagentChildRunTerminalReader,
  type SubagentFinalAssistantMessageReader,
  type SubagentLifecycleEventIdFactory,
  type SubagentResult,
} from "../../../runtime/subagent/index.js";
import {
  SUBAGENT_TOOL_GROUP_MANIFEST,
  createAgentExecutionToolRegistry,
  type SubagentTaskCancellationIntentPort,
} from "../../../tools/subagent/index.js";
import {
  ToolGroupCatalog,
  ToolGroupCatalogError,
  ToolRegistry,
} from "../../../tooling/index.js";
import {
  ChildRuntimeSubagentClient,
  createChildSubagentScopeReaders,
  type RuntimeSubagentRpcRequester,
} from "../subagent/index.js";
import {
  AgentRuntimeConfigurationFactory,
  AgentRuntimeExecutionLimits,
  AgentRuntimeExecutionAssembly,
  AgentRuntimePolicyReferences,
  AgentRuntimeRunExecutor,
  AgentRuntimeStopCancellationPort,
  BaseContextCompiler,
  ConversationRuntime,
  InMemoryAgentRuntimeConfigurationProfileResolver,
  InputRouter,
  JournalRuntimeInputResolver,
  JournalRuntimeReplayPlanner,
  PublishingRuntimeEventSink,
  RuntimeBootstrapStartupCoordinator,
  RuntimeInputOutcomeController,
  RuntimeInputPump,
  NudgeManager,
  NudgeProviderCallCoordinator,
  NudgeRenderer,
  NudgeSelector,
  NudgeTemplateRegistry,
  InMemoryPendingNudgeStore,
  RuntimeApprovalDecisionInputHandler,
  RuntimeControlInputDispatcher,
  RuntimeConversationModeSetInputHandler,
  RuntimeEffectCoordinator,
  RuntimeNudgePolicyEffectHandler,
  RuntimePolicyEngine,
  TODO_STATUS,
  type NudgeLifecycleEventIdFactory,
  type NudgeLifecycleEventIdInput,
  type NudgeProviderCallCoordinator as NudgeProviderCallCoordinatorType,
  RuntimeStartupExecutor,
  RuntimeStartupReconciler,
  RuntimeStopInputHandler,
  RuntimeUserMessageInputHandler,
  Sha256RuntimeEventIdFactory,
  TurnController,
  type AgentRuntimeAdapter,
  type AgentRuntimeConfiguration,
  type AgentRuntimeConfigurationProfileResolver,
  type AgentRuntimeContextCompilerFactory,
  type RuntimeEventIdFactory,
  type RuntimeEventSink,
  type RuntimeRunPreparationSource,
  type ToolDispatcher,
} from "../../../runtime/index.js";
import { NUDGE_DEFINITIONS } from "../../../runtime/nudge/definitions/index.js";
import type { PiRuntimeSignalsProvider } from "../../../runtime/agent/pi/index.js";
import { RuntimePromptAssembler } from "../../../runtime/context/index.js";
import { PromptAssemblyBuilder } from "../../../prompt/assembly/index.js";
import { createChildToolExecutionComposition } from "./ChildToolExecutionFactory.js";
import type { RuntimePersistencePorts } from "../../../runtime/ipc/index.js";
import { createNovelConversationManifestComposition } from "../../agent/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import { createCoreEventSchemaRegistry } from "../../../event/index.js";
import { OUTPUT_EVENT_TYPE } from "../../../event/output/OutputEventType.js";
import {
  ConversationTodoCoordinator,
  ConversationTodoProjector,
  InMemoryConversationTodoStore,
} from "../../../runtime/todo/index.js";
import { ComposeModeStateProvider } from "../../../runtime/compose/index.js";
import { NodeSha256RuntimeEventIdHasher } from "../NodeSha256RuntimeEventIdHasher.js";
import { openChildNovelToolRegistry } from "./novel/index.js";
import type {
  ChildRuntimeWorkspaceStore,
  ChildRuntimeWorkspaceStoreProvider,
  RuntimeChildCompositionContext,
  RuntimeChildCompositionFactory,
  RuntimeChildRuntime,
} from "./RuntimeChildCompositionFactory.js";

const DESKTOP_CHILD_STORAGE_ROOT_ENV = "NOVEL_DESKTOP_STORAGE_ROOT" as const;

export interface RuntimeRunPreparationSourceFactory {
  create(options: {
    readonly configuration: AgentRuntimeConfiguration;
    readonly bootstrap: ConversationRuntimeBootstrap;
    readonly persistence: RuntimePersistencePorts;
  }): Promise<RuntimeRunPreparationSource>;
}

export interface RuntimeChildAdapterFactory {
  create(options: {
    readonly configuration: AgentRuntimeConfiguration;
    readonly lifecycleController: TurnController;
    readonly nudgeProviderCalls?: NudgeProviderCallCoordinatorType;
    /** 域 runtime 信号源 + policy 引擎装配（nudge 瞬态注入用）。 */
    readonly runtimeSignals?: PiRuntimeSignalsProvider;
    readonly policyEngine?: RuntimePolicyEngine;
    readonly effectCoordinator?: RuntimeEffectCoordinator;
    readonly eventSink: PublishingRuntimeEventSink;
    readonly eventIdFactory: RuntimeEventIdFactory;
    readonly toolDispatcher?: ToolDispatcher;
  }): Promise<AgentRuntimeAdapter>;
}

export interface DesktopRuntimeChildCompositionFactoryOptions {
  readonly manifestStoreProvider: (
    bootstrap: ConversationRuntimeBootstrap,
  ) => Promise<AgentManifestStore>;
  /** 会话目录 store 提供者(会话 mode 持久化 + hydrate)。可选;不传则 mode 仅内存。 */
  /** Conversation catalog store provider (persistent mode + hydrate). Optional; mode stays in-memory otherwise. */
  readonly conversationCatalogStoreProvider?: (
    bootstrap: ConversationRuntimeBootstrap,
  ) => Promise<ConversationCatalogStore>;
  /** 完整 workspace store 提供者(含子代理绑定)。可选;传则组装真实子代理工具。 */
  /** Full workspace-store provider (with subagent bindings). Optional; enables real subagent tool assembly. */
  readonly workspaceStoreProvider?: ChildRuntimeWorkspaceStoreProvider;
  readonly novelStorageRoot?: string;
  readonly adapterFactory: RuntimeChildAdapterFactory;
  readonly contextCompilerFactory: AgentRuntimeContextCompilerFactory;
  readonly preparationSourceFactory: RuntimeRunPreparationSourceFactory;
  readonly profileResolver?: AgentRuntimeConfigurationProfileResolver;
  readonly eventSchemaRegistry?: ReturnType<typeof createCoreEventSchemaRegistry>;
  readonly eventIdFactory?: RuntimeEventIdFactory;
  /** 外部共享的 compose 状态源（与 run preparation source 同一实例）。 */
  /** Externally shared compose state source (same instance as the run preparation source). */
  readonly composeState?: ComposeModeStateProvider;
  readonly logger?: Logger;
}

export class DesktopRuntimeChildCompositionFactory
  implements RuntimeChildCompositionFactory
{
  readonly #manifestStoreProvider: (
    bootstrap: ConversationRuntimeBootstrap,
  ) => Promise<AgentManifestStore>;
  readonly #conversationCatalogStoreProvider?: (
    bootstrap: ConversationRuntimeBootstrap,
  ) => Promise<ConversationCatalogStore>;
  readonly #workspaceStoreProvider?: ChildRuntimeWorkspaceStoreProvider;
  readonly #novelStorageRoot?: string;
  readonly #adapterFactory: RuntimeChildAdapterFactory;
  readonly #contextCompilerFactory: AgentRuntimeContextCompilerFactory;
  readonly #preparationSourceFactory: RuntimeRunPreparationSourceFactory;
  readonly #profileResolver: AgentRuntimeConfigurationProfileResolver;
  readonly #eventSchemaRegistry: ReturnType<typeof createCoreEventSchemaRegistry>;
  readonly #eventIdFactory: RuntimeEventIdFactory;
  readonly #composeState: ComposeModeStateProvider;
  readonly #promptDigester: PromptDigester;
  readonly #logger: Logger;

  constructor(options: DesktopRuntimeChildCompositionFactoryOptions) {
    const logger = (options.logger ?? noopLogger).child({
      component: "desktop_runtime_child_composition_factory",
    });
    const composition = createNovelConversationManifestComposition();
    this.#manifestStoreProvider = options.manifestStoreProvider;
    this.#conversationCatalogStoreProvider =
      options.conversationCatalogStoreProvider;
    this.#workspaceStoreProvider = options.workspaceStoreProvider;
    this.#novelStorageRoot = options.novelStorageRoot;
    this.#adapterFactory = options.adapterFactory;
    this.#contextCompilerFactory = options.contextCompilerFactory;
    this.#preparationSourceFactory = options.preparationSourceFactory;
    this.#profileResolver =
      options.profileResolver ??
      new InMemoryAgentRuntimeConfigurationProfileResolver([
        Object.freeze({
          policies: new AgentRuntimePolicyReferences({
            runtimePolicyId: "default",
            contextPolicyId: "default",
            nudgePolicyId: "default",
          }),
          limits: new AgentRuntimeExecutionLimits({
            maximumTurns: 20,
            maximumProviderCallsPerTurn: 4,
            maximumToolCallsPerTurn: 16,
            providerCallTimeoutMs: 60_000,
            toolExecutionTimeoutMs: 30_000,
          }),
        }),
      ]);
    this.#promptDigester = composition.digester;
    this.#eventSchemaRegistry =
      options.eventSchemaRegistry ?? createCoreEventSchemaRegistry();
    this.#eventIdFactory =
      options.eventIdFactory ??
      new Sha256RuntimeEventIdFactory({
        hasher: new NodeSha256RuntimeEventIdHasher(),
      });
    this.#composeState = options.composeState ?? new ComposeModeStateProvider();
    this.#logger = logger;
  }

  async create(
    bootstrap: ConversationRuntimeBootstrap,
    context: RuntimeChildCompositionContext,
  ): Promise<RuntimeChildRuntime> {
    try {
      return await this.#createOnce(bootstrap, context);
    } catch (error) {
      this.#logger.error("runtime_child.composition_failed", {
        conversationId: bootstrap?.conversation?.metadata?.id,
        failure: captureStableFailure(error),
      });
      // 记录失败类型便于诊断；不记录原始消息/堆栈/cause（脱敏）。
      this.#logger.error("runtime_child.composition_failed_detail", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      // 诊断：ToolGroupCatalogError 的 failure（duplicate_group/unknown_group）与
      // groupId 均为校验过的枚举/稳定 id，可安全记录，用于区分两条抛错路径。
      if (error instanceof ToolGroupCatalogError) {
        this.#logger.error("runtime_child.composition_failed_group_catalog", {
          failure: error.failure,
          ...(error.groupId === undefined ? {} : { groupId: error.groupId }),
        });
      }
      throw error;
    }
  }

  async #createOnce(
    bootstrap: ConversationRuntimeBootstrap,
    context: RuntimeChildCompositionContext,
  ): Promise<RuntimeChildRuntime> {
    const conversationId = bootstrap.conversation.metadata.id;
    const runtimeInstanceId = bootstrap.runtimeInstanceId;
    const logger = this.#logger.child({ conversationId });
    const persistence = context.persistence;
    if (persistence === undefined) {
      throw new TypeError("Runtime child persistence composition is missing");
    }

    const manifestStore = await this.#manifestStoreProvider(bootstrap);
    logger.info("runtime_child.composition.manifest_store_opened", {
      conversationId,
    });
    const journal = new ChildRuntimeJournalReader(persistence);
    const eventSink = new PublishingRuntimeEventSink({
      outputPublisher: new ChildRuntimeOutputPublisher(persistence, logger),
      logger,
    });
    const clock = { now: () => new Date().toISOString() };
    const todoStore = new InMemoryConversationTodoStore();
    // 从 journal 重放 todo 事件到进程内 store：跨进程重启后 todo_idle 仍能读到
    // 最后一次 TodoWrite 的 runId（lastUpdatedRunId），继续跨 run 轮次计数。
    await replayConversationTodos(journal, conversationId, todoStore);
    const todoWriter = new ConversationTodoCoordinator({
      store: todoStore,
      eventSink,
      clock,
      logger,
    });
    const composeState = this.#composeState;
    const conversations =
      this.#conversationCatalogStoreProvider === undefined
        ? undefined
        : await this.#conversationCatalogStoreProvider(bootstrap);
    const novelTools = await openChildNovelToolRegistry({
      storageRoot: requireNovelStorageRoot(
        this.#novelStorageRoot ?? process.env[DESKTOP_CHILD_STORAGE_ROOT_ENV],
      ),
      workdir: bootstrap.workspace.workdir,
      todoWriter,
      composeState,
      eventSink,
      ...(conversations === undefined ? {} : { conversations }),
      logger,
    });
    // 从持久层还原会话 mode + compose 子状态(重启恢复;权威来源为 workspace DB)。
    await novelTools.modeService.hydrate(conversationId);
    logger.info("runtime_child.composition.novel_registry_opened", {
      conversationId,
    });
    const novelAndSubagentTools =
      this.#workspaceStoreProvider === undefined
        ? { registry: novelTools.registry, groups: novelTools.groups }
        : createChildSubagentComposition({
            bootstrap,
            store: await this.#workspaceStoreProvider(bootstrap),
            registry: novelTools.registry,
            groups: novelTools.groups,
            requester: context.requester,
            promptDigester: this.#promptDigester,
            persistence,
            eventSink,
            clock,
            logger,
          });
    logger.info("runtime_child.composition.subagent_registry_created", {
      conversationId,
    });
    const configurationFactory = new AgentRuntimeConfigurationFactory({
      manifestStore,
      assemblyRestorer: new AgentAssemblyRestorer({
        registry: novelAndSubagentTools.registry,
        groups: novelAndSubagentTools.groups,
      }),
      profileResolver: this.#profileResolver,
      logger,
    });
    const configuration = await configurationFactory.create(bootstrap);
    logger.info("runtime_child.composition.configuration_restored", {
      conversationId,
      agentType: configuration.assembly.agentType,
      definitionVersion: configuration.assembly.definitionVersion,
    });
    const contextCompiler = await this.#contextCompilerFactory.create(
      configuration,
    );
    const toolExecution = createChildToolExecutionComposition({
      registryView: configuration.assembly.toolView,
      eventSink,
      composeStateProvider: composeState,
      logger,
    });
    logger.info("runtime_child.composition.tool_execution_created", {
      conversationId,
    });
    const eventIdFactory = this.#eventIdFactory;
    const lifecycleController = new TurnController({
      conversationId,
      eventIdFactory,
      eventSink,
      clock,
      logger,
    });
    const outcomeRecorder = new RuntimeInputOutcomeController({
      conversationId,
      eventIdFactory,
      eventSink,
      clock,
      logger,
    });
    const router = new InputRouter({ conversationId, logger });
    const nudgeAssembly = createChildNudgeAssembly({
      conversationId,
      eventSink,
      persistence,
      logger,
    });
    const nudgeProviderCalls = nudgeAssembly.coordinator;
    // nudge 定义装配：模板注册 + 生效集（agent enablesNudges ∩ 工具组守卫）→
    // policy 引擎 + effect coordinator（nudge_schedule/acknowledge → manager）。
    const manifestToolGroups = new Set(
      configuration.assembly.manifest.definition.tools.groupIds,
    );
    const enabledNudges = resolveAgentNudgeEnablements(
      configuration.assembly.agentType,
    ).enabled;
    const effectiveDefinitions = [];
    for (const definition of NUDGE_DEFINITIONS) {
      if (!enabledNudges.includes(definition.id)) continue;
      if (!manifestToolGroups.has(definition.requiredToolGroup)) {
        logger.warn("nudge.rule_skipped_group_guard", {
          nudgeId: definition.id,
          requiredToolGroup: definition.requiredToolGroup,
        });
        continue;
      }
      nudgeAssembly.templates.register(definition.template);
      effectiveDefinitions.push(definition);
    }
    // 同一 policy 可能被多个 nudge 定义共享（如 compose_mode + compose_mode_exit
    // 同属 ComposeModeNudgePolicy）；引擎按 policy.id 拒绝重复，需先按 id 去重。
    const seenPolicyIds = new Set<string>();
    const effectivePolicies = [];
    for (const definition of effectiveDefinitions) {
      const policy = definition.createPolicy();
      if (seenPolicyIds.has(policy.id)) continue;
      seenPolicyIds.add(policy.id);
      effectivePolicies.push(policy);
    }
    const policyEngine = new RuntimePolicyEngine({
      policies: effectivePolicies,
      logger,
    });
    const effectCoordinator = new RuntimeEffectCoordinator({
      conversationId,
      nudgeLifecycleHandler: new RuntimeNudgePolicyEffectHandler(
        nudgeAssembly.manager,
      ),
      logger,
    });
    const runtimeSignals: PiRuntimeSignalsProvider = Object.freeze({
      compose: () => Promise.resolve(composeState.snapshot(conversationId)),
      todos: () =>
        todoStore.read(conversationId).then((snapshot) =>
          snapshot === undefined
            ? undefined
            : {
                inProgressCount: snapshot.todos.filter(
                  (todo) => todo.status === TODO_STATUS.inProgress,
                ).length,
                ...(snapshot.lastUpdatedRunId === undefined
                  ? {}
                  : { lastUpdatedRunId: snapshot.lastUpdatedRunId }),
              },
        ),
    });
    const agentAdapter = await this.#adapterFactory.create({
      configuration,
      lifecycleController,
      nudgeProviderCalls,
      runtimeSignals,
      policyEngine,
      effectCoordinator,
      eventSink,
      eventIdFactory,
      toolDispatcher: toolExecution.dispatcher,
    });
    const assembly = new AgentRuntimeExecutionAssembly({
      configuration,
      contextCompiler,
      agentAdapter,
    });
    const preparationSource = await this.#preparationSourceFactory.create({
      configuration,
      bootstrap,
      persistence,
    });
    const runExecutor = new AgentRuntimeRunExecutor({
      conversationId,
      preparationSource,
      assembler: new RuntimePromptAssembler(
        new PromptAssemblyBuilder({
          digester: this.#promptDigester,
          logger,
        }),
      ),
      agentAdapter,
      lifecycleController,
      logger,
    });
    const turnHandler = new RuntimeUserMessageInputHandler({
      conversationId,
      lifecycleController,
      outcomeRecorder,
      runExecutor,
      logger,
    });
    const cancellationPort = new AgentRuntimeStopCancellationPort({
      conversationId,
      agentAdapter,
      logger,
    });
    const controlHandler = new RuntimeControlInputDispatcher({
      stopHandler: new RuntimeStopInputHandler({
        conversationId,
        stopFence: router,
        lifecycleController,
        outcomeRecorder,
        cancellationPort,
        logger,
      }),
      approvalDecisionHandler: new RuntimeApprovalDecisionInputHandler({
        conversationId,
        coordinator: toolExecution.coordinator,
        runId: () => lifecycleController.getRunSnapshot()?.runId,
        turnId: () => lifecycleController.getTurnSnapshot()?.turnId,
        outcomeRecorder,
        logger,
      }),
      modeSetHandler: new RuntimeConversationModeSetInputHandler({
        conversationId,
        modeService: novelTools.modeService,
        outcomeRecorder,
        logger,
      }),
    });
    const inputPump = new RuntimeInputPump({
      conversationId,
      source: router,
      controlHandler,
      turnHandler,
      clock,
      logger,
    });
    const inputResolver = new JournalRuntimeInputResolver({
      journal,
      eventSchemaRegistry: this.#eventSchemaRegistry,
      logger,
    });
    const startupCoordinator = new RuntimeBootstrapStartupCoordinator({
      conversationId,
      runtimeInstanceId,
      replayPlanner: new JournalRuntimeReplayPlanner({
        journal,
        eventSchemaRegistry: this.#eventSchemaRegistry,
        eventIdFactory,
        logger,
      }),
      startupReconciler: new RuntimeStartupReconciler({ logger }),
      startupExecutor: new RuntimeStartupExecutor({
        conversationId,
        outcomeController: outcomeRecorder,
        turnController: lifecycleController,
        inputRouter: router,
        logger,
      }),
      logger,
    });
    const runtime = new ConversationRuntime({
      conversationId,
      runtimeInstanceId,
      startupCoordinator,
      inputResolver,
      inputRouter: router,
      inputPump,
      clock,
      logger,
    });
    logger.info("runtime_child.composition_created", {
      agentType: configuration.assembly.agentType,
      definitionVersion: configuration.assembly.definitionVersion,
    });
    return new ConversationRuntimeChild(runtime, logger);
  }
}

function requireNovelStorageRoot(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new TypeError("Desktop child Novel storage root is not configured");
  }
  return value;
}

interface ChildSubagentToolComposition {
  readonly registry: ToolRegistry;
  readonly groups: ToolGroupCatalog;
}

interface CreateChildSubagentCompositionOptions {
  readonly bootstrap: ConversationRuntimeBootstrap;
  readonly store: ChildRuntimeWorkspaceStore;
  readonly registry: ToolRegistry;
  readonly groups: ToolGroupCatalog;
  readonly requester: RuntimeSubagentRpcRequester;
  readonly promptDigester: PromptDigester;
  readonly persistence: RuntimePersistencePorts;
  readonly eventSink: RuntimeEventSink;
  readonly clock: ChildConversationManagerClock;
  readonly logger: Logger;
}

/**
 * 组装子代理 manager/tools：窄 RPC client → 会话 adapter → durable manager →
 * TaskGet 查询 → Agent/TaskOutput/TaskStop 工具，返回并入子代理工具后的最终
 * registry/groups 供运行期 Manifest 还原。
 * Composes the subagent manager/tools over the narrow RPC client, then returns
 * the final registry/groups (base Novel tools + subagent tools) used for runtime
 * Manifest restoration.
 */
function createChildSubagentComposition(
  options: CreateChildSubagentCompositionOptions,
): ChildSubagentToolComposition {
  const { bootstrap, store, registry, groups, requester, logger } = options;
  const subagentClient = new ChildRuntimeSubagentClient({ requester, logger });
  const scopeReaders = createChildSubagentScopeReaders(bootstrap);
  const bindings = store.createSubagentBindingStore();
  const agentAssembler = new AgentAssembler({
    registry,
    groups,
    manifestResolver: new AgentManifestResolver({
      promptBuilder: new ManifestSystemPromptCompiler({
        sections: createDefaultPromptSectionRegistry(),
        digester: options.promptDigester,
      }),
      promptCapabilities: new PromptCapabilitySnapshot([]),
      manifestIdFactory: SUBAGENT_MANIFEST_ID_FACTORY,
      clock: options.clock,
      digester: options.promptDigester,
      logger,
    }),
    manifestStore: store.agentManifests,
    logger,
  });
  const adapter = new CatalogHostChildConversationAdapter({
    catalog: store.conversations,
    host: subagentClient.host,
    agentDefinitions: new AgentDefinitionCatalog([
      novelAgentDefinition,
      novelExplorerAgentDefinition,
      novelComposeAgentDefinition,
    ]),
    agentAssembler,
    manifestStore: store.agentManifests,
    manifestIdFactory: SUBAGENT_MANIFEST_ID_FACTORY,
    commandService: subagentClient.commandService,
    idFactory: CHILD_CONVERSATION_ID_FACTORY,
    logger,
  });
  const manager = new DurableChildConversationManager(
    new DefaultChildConversationManager({
      parentScopeReader: scopeReaders.parentScopeReader,
      toolPolicyRelationReader: scopeReaders.toolPolicyRelationReader,
      creationPort: adapter,
      activationPort: adapter,
      rollbackPort: adapter,
      taskAssignmentPort: adapter,
      clock: options.clock,
      logger,
    }),
    bindings,
  );
  // 子会话消息经窄 RPC 读取：父绑定 persistence 对子会话 identity_mismatch，
  // 必须走 workspace journalReader 服务的 subagent RPC 通道。
  // Child final messages must go through the subagent narrow RPC (served by the
  // workspace journal reader); the parent-bound persistence port rejects the
  // child conversation identity.
  const finalAssistantMessages = createChildFinalAssistantMessageReader(
    subagentClient,
  );
  // 完成链路：子会话 run 终态 → bridge → lifecycle.deliverResult →
  // 父会话终态事件 + binding 落库（running→completed/failed/cancelled）。
  // Completion path: child Run terminal → bridge → lifecycle.deliverResult →
  // parent terminal event + durable binding terminal transition.
  const lifecycle = new DefaultSubagentLifecycleCoordinator({
    manager,
    eventSink: options.eventSink,
    eventIdFactory: SUBAGENT_LIFECYCLE_EVENT_ID_FACTORY,
    clock: options.clock,
    logger,
  });
  const bridge = new SubagentCompletionBridge({
    bindings,
    finalAssistantMessages,
    resultSink: lifecycle,
    logger,
  });
  const completion = new SubagentCompletionObserver({
    bindings,
    bridge,
    childRunTerminal: createChildRunTerminalReader(subagentClient),
    logger,
  });
  const query = new SubagentTaskQueryService({
    bindings,
    runtimePresence: createChildRuntimePresenceReader(bindings),
    finalAssistantMessages,
    limits: NOVEL_SUBAGENT_TOOL_COMPOSITION_POLICY.limits,
    completion,
    logger,
  });
  const cancellation: SubagentTaskCancellationIntentPort = {
    async requestCancellation(binding) {
      await subagentClient.host.shutdownRuntime({
        conversationId: binding.childConversationId,
        reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
      });
      // shutdown 会终止子进程，run 可能来不及落 cancelled 终态，TaskStop 直接交付
      // cancelled 结果，立即把 binding 翻成 cancelled（deliverResult 幂等）。
      // Shutdown kills the child process; the Run may not land a cancelled
      // terminal, so TaskStop delivers the cancelled result directly.
      await lifecycle.deliverResult(
        cancelledSubagentResult(binding, options.clock.now()),
      );
      return SUBAGENT_TASK_CANCELLATION_STATUS.cancellationRequested;
    },
  };
  const subagentTools = createAgentExecutionToolRegistry({
    definitions: createProductionSubagentDefinitionCatalog(),
    policy: NOVEL_SUBAGENT_TOOL_COMPOSITION_POLICY,
    manager,
    bindings,
    query,
    cancellation,
    logger,
  });
  // 诊断：合并 base groups 与 subagent group 前记录实际 group id（脱敏稳定 id），
  // 确认 base 是否被污染进 runtime.subagent。
  logger.debug("runtime_child.composition.subagent_group_merge", {
    baseGroupIds: groups.list().map((g) => g.id).join(","),
    addedGroupId: SUBAGENT_TOOL_GROUP_MANIFEST.id,
  });
  let subagentGroups: ToolGroupCatalog;
  try {
    subagentGroups = new ToolGroupCatalog([
      ...groups.list(),
      SUBAGENT_TOOL_GROUP_MANIFEST,
    ]);
  } catch (error) {
    if (error instanceof ToolGroupCatalogError) {
      logger.error("runtime_child.composition.subagent_group_catalog_failed", {
        failure: error.failure,
        ...(error.groupId === undefined ? {} : { groupId: error.groupId }),
      });
    }
    throw error;
  }
  return Object.freeze({
    registry: new ToolRegistry([...registry.list(), ...subagentTools.list()]),
    groups: subagentGroups,
  });
}

const CHILD_CONVERSATION_ID_FACTORY: ChildConversationIdFactory = {
  create(input): string {
    return `conversation-child-${input.subagentId}`;
  },
};

// 子代理 manifest 稳定 id（跨 spawn 复用；manifest store 写一次语义）。
// Stable subagent manifest id shared by the resolver and the child adapter
// (reused across spawns; the manifest store is write-once per id).
const SUBAGENT_MANIFEST_ID_FACTORY: AgentManifestIdFactory = Object.freeze({
  create(input: {
    readonly agentType: string;
    readonly definitionVersion: string;
  }): string {
    return `manifest:subagent:${input.agentType}:${input.definitionVersion}`;
  },
});

// 确定性生命周期事件 ID：重试/重启后重建同 ID 事件，journal 幂等去重。
// Deterministic lifecycle event IDs so retried projections overwrite in place.
const SUBAGENT_LIFECYCLE_EVENT_ID_FACTORY: SubagentLifecycleEventIdFactory = {
  create(input): string {
    return [
      "subagent",
      input.parentConversationId,
      input.parentRunId,
      input.subagentId,
      input.eventType,
      input.ordinal,
    ].join(":");
  },
};

// 把窄 RPC 的 readChildRunTerminal 响应适配为 observer 端口形状。
// Adapts the narrow RPC readChildRunTerminal response to the observer port.
function createChildRunTerminalReader(
  client: ChildRuntimeSubagentClient,
): SubagentChildRunTerminalReader {
  return {
    async readChildRunTerminal(conversationId) {
      const response = await client.readChildRunTerminal(conversationId);
      if (response.found === false) return undefined;
      return Object.freeze({
        status: response.status,
        completedAt: response.completedAt,
        ...(response.errorCode === undefined
          ? {}
          : { errorCode: response.errorCode }),
        ...(response.cancellationReason === undefined
          ? {}
          : { cancellationReason: response.cancellationReason }),
      });
    },
  };
}

function cancelledSubagentResult(
  binding: SubagentBinding,
  completedAt: string,
): SubagentResult {
  return Object.freeze({
    schemaVersion: SUBAGENT_SCHEMA_VERSION,
    subagentId: binding.subagentId,
    parentConversationId: binding.parentConversationId,
    parentRunId: binding.parentRunId,
    childConversationId: binding.childConversationId,
    status: "cancelled",
    artifactReferences: Object.freeze([]),
    cancellationReason: SUBAGENT_CANCELLATION_REASON.explicit,
    completedAt,
  });
}

function createChildRuntimePresenceReader(
  bindings: SubagentBindingStore,
): ConversationRuntimePresenceReader {
  return {
    async getRuntimePresence(conversationId) {
      const active = (await bindings.list()).find(
        (binding) => binding.childConversationId === conversationId,
      );
      if (active === undefined) {
        return {
          state: "offline",
          observedAt: new Date().toISOString(),
        };
      }
      return {
        state:
          active.status === "creating" || active.status === "running"
            ? "online"
            : "offline",
        observedAt: active.updatedAt,
      };
    },
  };
}

function createChildFinalAssistantMessageReader(
  client: ChildRuntimeSubagentClient,
): SubagentFinalAssistantMessageReader {
  return {
    async readFinalAssistantMessage(conversationId) {
      const response = await client.readChildFinalAssistantMessage(conversationId);
      if (response.found === false) return undefined;
      return Object.freeze({
        content: response.content,
        artifactReferences: Object.freeze([]),
      });
    },
  };
}

class ConversationRuntimeChild implements RuntimeChildRuntime {
  constructor(
    private readonly runtime: ConversationRuntime,
    private readonly logger: Logger,
  ) {}

  get conversationId(): string {
    return this.runtime.conversationId;
  }

  get runtimeInstanceId(): string {
    return this.runtime.runtimeInstanceId;
  }

  start(bootstrap: ConversationRuntimeBootstrap) {
    return this.runtime.start(bootstrap);
  }

  dispatchInput(input: ConversationRuntimeInputReference): Promise<void> {
    return this.runtime.dispatchInput(input);
  }

  shutdown(request: ConversationRuntimeHandleShutdownRequest): Promise<void> {
    return this.runtime.shutdown(request);
  }

  waitForExit(): Promise<ConversationRuntimeExit> {
    return this.runtime.waitForExit();
  }

  close(): Promise<void> {
    this.logger.debug("runtime_child.closed");
    return Promise.resolve();
  }
}

class ChildRuntimeJournalReader implements ConversationJournalReader {
  constructor(private readonly persistence: RuntimePersistencePorts) {}

  async getHighWatermark(conversationId: string): Promise<number> {
    const page = await this.persistence.journal.listEvents({
      conversationId,
      anchor: { from: "start" },
      limit: 1,
    });
    return page.highWatermark;
  }

  async getBySequence(
    conversationId: string,
    sequence: number,
  ): Promise<PersistedConversationEventSnapshot | undefined> {
    return this.persistence.journal.getEvent(conversationId, sequence);
  }

  async getByEventId(
    conversationId: string,
    eventId: string,
  ): Promise<PersistedConversationEventSnapshot | undefined> {
    const page = await this.persistence.journal.listEvents({
      conversationId,
      anchor: { from: "start" },
      limit: 1_000,
    });
    return page.events.find((event) => event.id === eventId);
  }

  list(query: ConversationEventQuery): Promise<ConversationEventPage> {
    return this.persistence.journal.listEvents(query);
  }
}

/** 重放某 conversation 的全部 todo.updated 输出事件到进程内 store（跨进程恢复）。 */
async function replayConversationTodos(
  journal: ChildRuntimeJournalReader,
  conversationId: string,
  todoStore: InMemoryConversationTodoStore,
): Promise<void> {
  const projector = new ConversationTodoProjector(todoStore);
  let cursor: number | undefined;
  do {
    const page = await journal.list({
      conversationId,
      anchor:
        cursor === undefined ? { from: "start" } : { afterSequence: cursor },
      direction: "output",
      eventTypes: [OUTPUT_EVENT_TYPE.agentTodoUpdated],
      limit: 500,
    });
    for (const event of page.events) {
      if (event.direction !== "output") continue;
      await projector.apply(event);
    }
    cursor = page.highWatermark;
    if (!page.hasNext) break;
  } while (true);
}

class ChildRuntimeOutputPublisher implements ConversationOutputEventPublisher {
  constructor(
    private readonly persistence: RuntimePersistencePorts,
    private readonly logger: Logger,
  ) {}

  publish(event: OutputEvent): Promise<OutputReceipt> {
    const snapshot = event.getSnapshot();
    // 逐 delta 不记日志（FD/体积）；只在拼接成完整事件时记。Delta events are not
    // logged per-chunk; only assembled events are.
    if (snapshot.eventType !== OUTPUT_EVENT_TYPE.agentAssistantMessageDelta) {
      this.logger.debug("runtime_child.output_publish_started", {
        conversationId: snapshot.conversationId,
        outputEventId: snapshot.id,
      });
    }
    return this.persistence.journal
      .appendOutput(snapshot.conversationId, snapshot)
      .then((receipt) => ({
        status: receipt.status === "duplicate" ? "duplicate" : "recorded",
        conversationId: receipt.conversationId,
        outputEventId: snapshot.id,
        sequence: receipt.sequence,
        recordedAt: receipt.recordedAt,
      }));
  }
}

function captureStableFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    return error.name;
  }
  return "unknown";
}

interface ChildNudgeAssembly {
  readonly coordinator: NudgeProviderCallCoordinatorType;
  readonly manager: NudgeManager;
  readonly templates: NudgeTemplateRegistry;
}

function createChildNudgeAssembly(options: {
  readonly conversationId: string;
  readonly eventSink: PublishingRuntimeEventSink;
  readonly persistence: RuntimePersistencePorts;
  readonly logger: Logger;
}): ChildNudgeAssembly {
  const templates = new NudgeTemplateRegistry({ logger: options.logger });
  const manager = new NudgeManager({
    store: new InMemoryPendingNudgeStore({ logger: options.logger }),
    selector: new NudgeSelector({ logger: options.logger }),
    renderer: new NudgeRenderer({ templates, logger: options.logger }),
    logger: options.logger,
  });
  const coordinator = new NudgeProviderCallCoordinator({
    manager,
    privateStateCommitter: {
      commit: async () => undefined,
    },
    eventSink: options.eventSink,
    eventIdFactory: new ChildNudgeLifecycleEventIdFactory(),
    logger: options.logger,
  });
  options.logger.debug("runtime_child.nudge_assembly_created", {
    conversationId: options.conversationId,
  });
  return { coordinator, manager, templates };
}

/**
 * 生成 nudge 生命周期事件 id。基于 providerCallId（每次 provider call 唯一，跨进程
 * 也唯一）而不是进程内计数器——计数重启归零曾导致同一 id 重复、journal append
 * 冲突（JournalEventConflictError）拖垮整个 run。事件 payload 携带同一
 * providerCallId，id↔payload 1:1，便于日志关联。
 * Generates nudge lifecycle event ids keyed on providerCallId (unique per provider
 * call, across process restarts) instead of a process-local counter.
 */
export class ChildNudgeLifecycleEventIdFactory implements NudgeLifecycleEventIdFactory {
  create(input: NudgeLifecycleEventIdInput): string {
    return `nudge_event_${input.nudgeId}_${input.providerCallId}`;
  }
}
