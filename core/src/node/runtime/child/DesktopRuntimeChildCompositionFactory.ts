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
} from "../../../runtime/index.js";
import type { RuntimePersistencePorts } from "../../../runtime/ipc/index.js";
import { createNovelConversationManifestComposition } from "../../agent/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import { createCoreEventSchemaRegistry } from "../../../event/index.js";
import { NodeSha256RuntimeEventIdHasher } from "../NodeSha256RuntimeEventIdHasher.js";
import type {
  RuntimeChildCompositionContext,
  RuntimeChildCompositionFactory,
  RuntimeChildRuntime,
} from "./RuntimeChildCompositionFactory.js";

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
  }): Promise<AgentRuntimeAdapter>;
}

export interface DesktopRuntimeChildCompositionFactoryOptions {
  readonly manifestStoreProvider: (
    bootstrap: ConversationRuntimeBootstrap,
  ) => Promise<AgentManifestStore>;
  readonly adapterFactory: RuntimeChildAdapterFactory;
  readonly contextCompilerFactory: AgentRuntimeContextCompilerFactory;
  readonly preparationSourceFactory: RuntimeRunPreparationSourceFactory;
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
  readonly #adapterFactory: RuntimeChildAdapterFactory;
  readonly #contextCompilerFactory: AgentRuntimeContextCompilerFactory;
  readonly #preparationSourceFactory: RuntimeRunPreparationSourceFactory;
  readonly #profileResolver: AgentRuntimeConfigurationProfileResolver;
  readonly #manifestRegistry: ReturnType<typeof createNovelConversationManifestComposition>["registry"];
  readonly #manifestGroups: ReturnType<typeof createNovelConversationManifestComposition>["groups"];
  readonly #eventSchemaRegistry: ReturnType<typeof createCoreEventSchemaRegistry>;
  readonly #eventIdFactory: RuntimeEventIdFactory;
  readonly #logger: Logger;

  constructor(options: DesktopRuntimeChildCompositionFactoryOptions) {
    const logger = (options.logger ?? noopLogger).child({
      component: "desktop_runtime_child_composition_factory",
    });
    const composition = createNovelConversationManifestComposition();
    this.#manifestStoreProvider = options.manifestStoreProvider;
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
    this.#manifestRegistry = composition.registry;
    this.#manifestGroups = composition.groups;
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
    const conversationId = bootstrap.conversation.metadata.id;
    const runtimeInstanceId = bootstrap.runtimeInstanceId;
    const logger = this.#logger.child({ conversationId });
    const persistence = context.persistence;
    if (persistence === undefined) {
      throw new TypeError("Runtime child persistence composition is missing");
    }

    const manifestStore = await this.#manifestStoreProvider(bootstrap);
    const configurationFactory = new AgentRuntimeConfigurationFactory({
      manifestStore,
      assemblyRestorer: new AgentAssemblyRestorer({
        registry: this.#manifestRegistry,
        groups: this.#manifestGroups,
      }),
      profileResolver: this.#profileResolver,
      logger,
    });
    const configuration = await configurationFactory.create(bootstrap);
    const contextCompiler = await this.#contextCompilerFactory.create(
      configuration,
    );

    const journal = new ChildRuntimeJournalReader(persistence);
    const eventSink = new PublishingRuntimeEventSink({
      outputPublisher: new ChildRuntimeOutputPublisher(persistence, logger),
      logger,
    });
    const eventIdFactory = this.#eventIdFactory;
    const clock = { now: () => new Date().toISOString() };
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
    const agentAdapter = await this.#adapterFactory.create({
      configuration,
      lifecycleController,
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
      contextCompiler,
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
    const controlHandler = new RuntimeStopInputHandler({
      conversationId,
      stopFence: router,
      lifecycleController,
      outcomeRecorder,
      cancellationPort,
      logger,
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
