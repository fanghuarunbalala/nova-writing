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
  OutputReceipt,
} from "../../../conversation/index.js";
import type { OutputEvent } from "../../../event/index.js";
import type {
  ConversationCatalogStore,
  ConversationEventPage,
  ConversationEventQuery,
  ConversationJournalReader,
  PersistedConversationEventSnapshot,
} from "../../../storage/index.js";
import {
  AgentAssemblyRestorer,
  resolveAgentNudgeEnablements,
  type AgentManifestStore,
} from "../../../agent/index.js";
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
  NudgeTemplateRegistry,
  RuntimeApprovalDecisionInputHandler,
  RuntimeControlInputDispatcher,
  RuntimeConversationModeSetInputHandler,
  RuntimeEffectCoordinator,
  RuntimePolicyEngine,
  RuntimeSystemReminderAttachPolicyEffectHandler,
  TODO_STATUS,
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
  type RuntimeRunPreparationSource,
  type ToolDispatcher,
} from "../../../runtime/index.js";
import {
  ComposeModeNudgePolicy,
} from "../../../runtime/nudge/definitions/compose.js";
import { NUDGE_DEFINITIONS } from "../../../runtime/nudge/definitions/index.js";
import type { PiRuntimeSignalsProvider } from "../../../runtime/agent/pi/index.js";
import { RuntimePromptAssembler } from "../../../runtime/context/index.js";
import { PromptAssemblyBuilder } from "../../../prompt/assembly/index.js";
import type { PromptDigester } from "../../../prompt/index.js";
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
    /** 域 runtime 信号源 + policy 引擎装配（reminder 注入用）。 */
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
    const configurationFactory = new AgentRuntimeConfigurationFactory({
      manifestStore,
      assemblyRestorer: new AgentAssemblyRestorer({
        registry: novelTools.registry,
        groups: novelTools.groups,
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
    const reminderAssembly = createChildReminderAssembly({
      conversationId,
      eventSink,
      persistence,
      logger,
    });
    // reminder 定义装配：模板注册 + 生效集（agent enablesNudges ∩ 工具组守卫）→
    // policy 引擎 + effect coordinator（system_reminder_attach → 持久化 + 注入）。
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
      reminderAssembly.templates.register(definition.template);
      effectiveDefinitions.push(definition);
    }
    // 同一 policy 可能被多个 reminder 定义共享（如 compose_mode + compose_mode_exit
    // 同属 ComposeModeNudgePolicy）；引擎按 policy.id 拒绝重复，需先按 id 去重。
    const seenPolicyIds = new Set<string>();
    const effectivePolicies = [];
    for (const definition of effectiveDefinitions) {
      const policy = definition.createPolicy();
      if (seenPolicyIds.has(policy.id)) continue;
      seenPolicyIds.add(policy.id);
      effectivePolicies.push(policy);
    }
    // compose latch 种子：用已 hydrate 的 compose 状态初始化，避免跨进程重启后把
    // 已在 compose 中误判为上升沿而重发 compose_mode。
    // Seed the compose latch with the hydrated compose state so an already-active
    // compose is not mistaken for a rising edge after a process restart.
    const composeSnapshot = composeState.snapshot(conversationId);
    for (const policy of effectivePolicies) {
      if (policy instanceof ComposeModeNudgePolicy) {
        policy.seed(conversationId, composeSnapshot);
      }
    }
    const policyEngine = new RuntimePolicyEngine({
      policies: effectivePolicies,
      logger,
    });
    const effectCoordinator = new RuntimeEffectCoordinator({
      conversationId,
      systemReminderAttachHandler:
        new RuntimeSystemReminderAttachPolicyEffectHandler({
          eventSink,
          templates: reminderAssembly.templates,
          logger,
        }),
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
    this.logger.debug("runtime_child.output_publish_started", {
      conversationId: snapshot.conversationId,
      outputEventId: snapshot.id,
    });
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

interface ChildReminderAssembly {
  readonly templates: NudgeTemplateRegistry;
}

function createChildReminderAssembly(options: {
  readonly conversationId: string;
  readonly eventSink: PublishingRuntimeEventSink;
  readonly persistence: RuntimePersistencePorts;
  readonly logger: Logger;
}): ChildReminderAssembly {
  const templates = new NudgeTemplateRegistry({ logger: options.logger });
  options.logger.debug("runtime_child.reminder_assembly_created", {
    conversationId: options.conversationId,
  });
  return { templates };
}
