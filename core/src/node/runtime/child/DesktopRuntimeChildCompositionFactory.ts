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
  ConversationEventPage,
  ConversationEventQuery,
  ConversationJournalReader,
  PersistedConversationEventSnapshot,
} from "../../../storage/index.js";
import {
  AgentAssemblyRestorer,
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
  NudgeManager,
  NudgeProviderCallCoordinator,
  NudgeRenderer,
  NudgeSelector,
  NudgeTemplateRegistry,
  InMemoryPendingNudgeStore,
  RuntimeApprovalDecisionInputHandler,
  RuntimeControlInputDispatcher,
  type NudgeLifecycleEventIdFactory,
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
  type RuntimeRunPreparationSource,
  type ToolDispatcher,
} from "../../../runtime/index.js";
import { RuntimePromptAssembler } from "../../../runtime/context/index.js";
import { PromptAssemblyBuilder } from "../../../prompt/assembly/index.js";
import type {
  EnvironmentInfoProvider,
  PromptDigester,
} from "../../../prompt/index.js";
import { createChildToolExecutionComposition } from "./ChildToolExecutionFactory.js";
import type { RuntimePersistencePorts } from "../../../runtime/ipc/index.js";
import { createNovelConversationManifestComposition } from "../../agent/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import { createCoreEventSchemaRegistry } from "../../../event/index.js";
import {
  ConversationTodoCoordinator,
  InMemoryConversationTodoStore,
} from "../../../runtime/todo/index.js";
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
    readonly nudgeProviderCalls?: NudgeProviderCallCoordinatorType;
    readonly eventSink: PublishingRuntimeEventSink;
    readonly eventIdFactory: RuntimeEventIdFactory;
    readonly toolDispatcher?: ToolDispatcher;
  }): Promise<AgentRuntimeAdapter>;
}

export interface DesktopRuntimeChildCompositionFactoryOptions {
  readonly manifestStoreProvider: (
    bootstrap: ConversationRuntimeBootstrap,
  ) => Promise<AgentManifestStore>;
  readonly novelStorageRoot?: string;
  readonly adapterFactory: RuntimeChildAdapterFactory;
  readonly contextCompilerFactory: AgentRuntimeContextCompilerFactory;
  readonly preparationSourceFactory: RuntimeRunPreparationSourceFactory;
  /**
   * 可选环境信息提供者工厂：按 bootstrap 构建（工作目录来自 bootstrap）。
   * Optional environment info provider factory, built per bootstrap (workdir
   * comes from the bootstrap).
   */
  readonly environmentInfoProviderFactory?: (
    bootstrap: ConversationRuntimeBootstrap,
  ) => EnvironmentInfoProvider;
  readonly profileResolver?: AgentRuntimeConfigurationProfileResolver;
  readonly eventSchemaRegistry?: ReturnType<typeof createCoreEventSchemaRegistry>;
  readonly eventIdFactory?: RuntimeEventIdFactory;
  readonly logger?: Logger;
}

export class DesktopRuntimeChildCompositionFactory
  implements RuntimeChildCompositionFactory
{
  readonly #manifestStoreProvider: (
    bootstrap: ConversationRuntimeBootstrap,
  ) => Promise<AgentManifestStore>;
  readonly #novelStorageRoot?: string;
  readonly #adapterFactory: RuntimeChildAdapterFactory;
  readonly #contextCompilerFactory: AgentRuntimeContextCompilerFactory;
  readonly #preparationSourceFactory: RuntimeRunPreparationSourceFactory;
  readonly #environmentInfoProviderFactory?: (
    bootstrap: ConversationRuntimeBootstrap,
  ) => EnvironmentInfoProvider;
  readonly #profileResolver: AgentRuntimeConfigurationProfileResolver;
  readonly #eventSchemaRegistry: ReturnType<typeof createCoreEventSchemaRegistry>;
  readonly #eventIdFactory: RuntimeEventIdFactory;
  readonly #promptDigester: PromptDigester;
  readonly #logger: Logger;

  constructor(options: DesktopRuntimeChildCompositionFactoryOptions) {
    const logger = (options.logger ?? noopLogger).child({
      component: "desktop_runtime_child_composition_factory",
    });
    const composition = createNovelConversationManifestComposition();
    this.#manifestStoreProvider = options.manifestStoreProvider;
    this.#novelStorageRoot = options.novelStorageRoot;
    this.#adapterFactory = options.adapterFactory;
    this.#contextCompilerFactory = options.contextCompilerFactory;
    this.#preparationSourceFactory = options.preparationSourceFactory;
    this.#environmentInfoProviderFactory = options.environmentInfoProviderFactory;
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
    const todoWriter = new ConversationTodoCoordinator({
      store: todoStore,
      eventSink,
      clock,
      logger,
    });
    const novelTools = await openChildNovelToolRegistry({
      storageRoot: requireNovelStorageRoot(
        this.#novelStorageRoot ?? process.env[DESKTOP_CHILD_STORAGE_ROOT_ENV],
      ),
      workdir: bootstrap.workspace.workdir,
      todoWriter,
      logger,
    });
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
    const nudgeProviderCalls = createChildNudgeCoordinator({
      conversationId,
      eventSink,
      persistence,
      logger,
    });
    const agentAdapter = await this.#adapterFactory.create({
      configuration,
      lifecycleController,
      nudgeProviderCalls,
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
          ...(this.#environmentInfoProviderFactory === undefined
            ? {}
            : { environmentInfo: this.#environmentInfoProviderFactory(bootstrap) }),
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

function createChildNudgeCoordinator(options: {
  readonly conversationId: string;
  readonly eventSink: PublishingRuntimeEventSink;
  readonly persistence: RuntimePersistencePorts;
  readonly logger: Logger;
}): NudgeProviderCallCoordinatorType {
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
  options.logger.debug("runtime_child.nudge_coordinator_created", {
    conversationId: options.conversationId,
  });
  return coordinator;
}

class ChildNudgeLifecycleEventIdFactory implements NudgeLifecycleEventIdFactory {
  #count = 0;

  create(input: {
    readonly conversationId: string;
    readonly runId: string;
    readonly eventType: string;
    readonly nudgeId: string;
  }): string {
    this.#count += 1;
    return `nudge_event_${input.nudgeId}_${this.#count}`;
  }
}
