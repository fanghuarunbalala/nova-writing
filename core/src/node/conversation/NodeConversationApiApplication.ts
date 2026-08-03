/** Composes the production local Conversation API over one SQLite Workspace Store. */
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
  type WorkspaceStoreLocation,
} from "../../storage/index.js";
import { SqliteWorkspaceStore } from "../sqlite/index.js";

export interface NodeConversationApiApplicationOptions {
  readonly workspace: WorkspaceStoreLocation;
  readonly placement: ConversationRuntimePlacement;
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
        catalog,
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
    } catch {
      if (store !== undefined) {
        const openedStore = store;
        await settleClose(() => openedStore.close());
      }
      logger.info("node_conversation_api.open_failed");
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
