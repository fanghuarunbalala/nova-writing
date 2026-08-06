/** Composes the production local Conversation API over one SQLite Workspace Store. */
import type { AgentManifestProvisioner } from "../../agent/index.js";
import { ConversationApiRouter } from "../../client/index.js";
import {
  CoreConversationHostControlDispatcher,
  CoreConversationInputRoutePolicy,
  ManagedConversationHost,
  RandomConversationRuntimeInstanceIdGenerator,
  StorageConversationCatalogService,
  StorageConversationCommandService,
  StorageConversationOutputEventPublisher,
  StorageConversationQueryService,
  StorageConversationRuntimeBootstrapFactory,
  SystemConversationHostClock,
  type ConversationCatalogService,
  type ConversationOutputEventPublisher,
  type ConversationHostClock,
  type ConversationIdGenerator,
  type ConversationRuntimeInstanceIdGenerator,
  type ConversationRuntimePlacement,
} from "../../conversation/index.js";
import {
  createCoreEventSchemaRegistry,
  type EventSchemaRegistry,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  InMemoryConversationEventHub,
  JournalConversationEventSubscriptionService,
  PublishingConversationJournalService,
  type ConversationCatalogStore,
  type ConversationMessageFileQuery,
  type WorkspaceStoreLocation,
} from "../../storage/index.js";
import { SqliteWorkspaceStore } from "../sqlite/index.js";
import { CoreRuntimeMessageProjector } from "../../runtime/message/projection/index.js";
import type { DesktopRuntimeChildPersistence } from "../runtime/child/index.js";
import { DefaultNovelAgentBindingConversationCatalog } from "./DefaultNovelAgentBindingConversationCatalog.js";

export interface NodeConversationApiApplicationOptions {
  readonly workspace: WorkspaceStoreLocation;
  readonly placement: ConversationRuntimePlacement;
  readonly agentManifestProvisioner?: AgentManifestProvisioner;
  readonly eventSchemaRegistry?: EventSchemaRegistry;
  readonly clock?: ConversationHostClock;
  readonly runtimeInstanceIdGenerator?: ConversationRuntimeInstanceIdGenerator;
  readonly conversationIdGenerator?: ConversationIdGenerator;
  readonly subscriptionPageSize?: number;
  readonly logger?: Logger;
}

export class NodeConversationApiApplication {
  readonly transport: ConversationApiRouter;
  readonly conversations: ConversationCatalogStore;
  readonly outputPublisher: ConversationOutputEventPublisher;
  readonly workspace: WorkspaceStoreLocation;

  private closePromise?: Promise<void>;

  private constructor(
    workspace: WorkspaceStoreLocation,
    private readonly store: SqliteWorkspaceStore,
    transport: ConversationApiRouter,
    outputPublisher: ConversationOutputEventPublisher,
    private readonly host: ManagedConversationHost,
    private readonly subscriptions: JournalConversationEventSubscriptionService,
    private readonly journal: PublishingConversationJournalService,
    private readonly hub: InMemoryConversationEventHub,
    private readonly logger: Logger,
  ) {
    this.workspace = Object.freeze({ ...workspace });
    this.transport = transport;
    this.conversations = store.conversations;
    this.outputPublisher = outputPublisher;
  }

  static async open(
    options: NodeConversationApiApplicationOptions,
  ): Promise<NodeConversationApiApplication> {
    const logger = (options.logger ?? noopLogger).child({
      component: "node_conversation_api_application",
      workspaceId: options.workspace.workspaceId,
    });
    const registry = options.eventSchemaRegistry ?? createCoreEventSchemaRegistry();
    let store: SqliteWorkspaceStore | undefined;
    try {
      store = await SqliteWorkspaceStore.open({
        workspace: options.workspace,
        eventSchemaRegistry: registry,
        logger,
      });
      const hub = new InMemoryConversationEventHub({ logger });
      const journal = new PublishingConversationJournalService({
        journal: store.journal,
        hub,
        logger,
      });
      const subscriptions = new JournalConversationEventSubscriptionService({
        journal: store.journal,
        hub,
        logger,
        ...(options.subscriptionPageSize !== undefined
          ? { pageSize: options.subscriptionPageSize }
          : {}),
      });
      const queries = new StorageConversationQueryService({
        catalog: store.conversations,
        journal: store.journal,
        subscriptions,
        logger,
      });
      const catalog = new StorageConversationCatalogService({
        catalog: store.conversations,
        workspaceId: options.workspace.workspaceId,
        ...(options.conversationIdGenerator !== undefined
          ? { conversationIdGenerator: options.conversationIdGenerator }
          : {}),
        logger,
      });
      const conversationCatalog = await composeDefaultAgentCatalog(
        options.agentManifestProvisioner,
        catalog,
        store,
        logger,
      );
      const outputPublisher = new StorageConversationOutputEventPublisher({
        eventSchemaRegistry: registry,
        journalService: journal,
        logger,
      });
      const clock = options.clock ?? new SystemConversationHostClock();
      const host = new ManagedConversationHost({
        snapshotReader: queries,
        bootstrapFactory: new StorageConversationRuntimeBootstrapFactory({
          snapshotReader: queries,
          journal: store.journal,
          workspace: options.workspace,
          agentManifestStore: store.agentManifests,
          logger,
        }),
        placement: options.placement,
        controlDispatcher: new CoreConversationHostControlDispatcher({
          outputPublisher,
          clock,
          logger,
        }),
        outputPublisher,
        clock,
        runtimeInstanceIdGenerator:
          options.runtimeInstanceIdGenerator ??
          new RandomConversationRuntimeInstanceIdGenerator(),
        logger,
      });
      const commands = new StorageConversationCommandService({
        metadataStore: store.conversations,
        journalService: journal,
        eventSchemaRegistry: registry,
        routePolicy: new CoreConversationInputRoutePolicy(),
        acceptedInputNotifier: host,
        logger,
      });
      const transport = new ConversationApiRouter({
        catalog: conversationCatalog,
        commands,
        queries,
        runtimePresence: host,
        logger,
      });
      logger.info("node_conversation_api.opened");
      return new NodeConversationApiApplication(
        options.workspace,
        store,
        transport,
        outputPublisher,
        host,
        subscriptions,
        journal,
        hub,
        logger,
      );
    } catch (error) {
      if (store !== undefined) {
        const openedStore = store;
        await settleClose(() => openedStore.close());
      }
      logger.info("node_conversation_api.open_failed");
      // 记录失败类型便于诊断；不记录原始消息/堆栈/cause（脱敏）。
      logger.error("node_conversation_api.open_failed_detail", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new NodeConversationApiApplicationOpenError();
    }
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    this.logger.info("node_conversation_api.close_started");
    const failures: string[] = [];
    await closeStage("router", () => this.transport.close(), failures);
    await closeStage("host", () => this.host.close(), failures);
    await closeStage("subscriptions", () => this.subscriptions.close(), failures);
    await closeStage("journal", () => this.journal.close(), failures);
    await closeStage("hub", () => this.hub.close(), failures);
    await closeStage("store", () => this.store.close(), failures);
    this.logger.info("node_conversation_api.close_completed", {
      failureCount: failures.length,
    });
    if (failures.length > 0) {
      throw new NodeConversationApiApplicationCloseError(failures);
    }
  }

  async getRuntimePersistence(
    _conversationId: string,
  ): Promise<DesktopRuntimeChildPersistence> {
    const context = this.store.createMessageProjectionContext({
      projector: new CoreRuntimeMessageProjector(),
    });
    this.logger.debug("node_conversation_api.runtime_persistence_bound");
    return Object.freeze({
      journalReader: this.store.journal,
      journalService: this.journal,
      messageStore: Object.freeze({
        list: async (query: ConversationMessageFileQuery) => {
          await context.projections.synchronize(query.conversationId);
          return context.messages.list(query);
        },
      }),
    });
  }
}

async function composeDefaultAgentCatalog(
  provisioner: AgentManifestProvisioner | undefined,
  catalog: ConversationCatalogService,
  store: SqliteWorkspaceStore,
  logger: Logger,
): Promise<ConversationCatalogService> {
  if (provisioner === undefined) {
    return catalog;
  }
  const defaultManifest = await provisioner.provision(store.agentManifests);
  if (defaultManifest === undefined) {
    return catalog;
  }
  logger.info("node_conversation_api.default_manifest_bound", {
    agentType: defaultManifest.agentType,
    definitionVersion: defaultManifest.definitionVersion,
    manifestDigest: defaultManifest.manifestDigest,
  });
  return new DefaultNovelAgentBindingConversationCatalog(catalog, defaultManifest, {
    logger,
  });
}

export class NodeConversationApiApplicationOpenError extends Error {
  readonly code = "NODE_CONVERSATION_API_OPEN_FAILED";

  constructor() {
    super("Node Conversation API application failed to open");
    this.name = "NodeConversationApiApplicationOpenError";
  }
}

export class NodeConversationApiApplicationCloseError extends Error {
  readonly code = "NODE_CONVERSATION_API_CLOSE_FAILED";
  readonly failedStages: readonly string[];

  constructor(failedStages: readonly string[]) {
    super("Node Conversation API application failed to close cleanly");
    this.name = "NodeConversationApiApplicationCloseError";
    this.failedStages = Object.freeze([...failedStages]);
  }
}

async function closeStage(
  stage: string,
  close: () => Promise<void>,
  failures: string[],
): Promise<void> {
  try {
    await close();
  } catch {
    failures.push(stage);
  }
}

async function settleClose(close: () => Promise<void>): Promise<void> {
  try {
    await close();
  } catch {
    return;
  }
}
