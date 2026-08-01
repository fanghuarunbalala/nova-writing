/**
 * Wires platform-neutral Message projection services to Node JSONL files and
 * one Workspace's shared Journal reader.
 */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  createCoreRuntimeMessageSchemaRegistry,
  type RuntimeMessageProjector,
  type RuntimeMessageSchemaRegistry,
} from "../../runtime/index.js";
import {
  JournalConversationMessageProjectionService,
  MessageProjectionRecordCodec,
  RuntimeMessageMaterializer,
  Sha256RuntimeMessageIdFactory,
  type ConversationJournalReader,
  type ConversationMessageFileStore,
  type ConversationMessageProjectionService,
  type MessageProjectionClock,
  type WorkspaceStoreLocation,
} from "../../storage/index.js";
import type { ConversationMessageFileLockOptions } from "./ConversationMessageFileLock.js";
import { JsonlConversationMessageStore } from "./JsonlConversationMessageStore.js";
import type { NodeConversationMessageProjectionContext } from "./NodeConversationMessageProjectionContext.js";
import { NodeSha256MessageProjectionHasher } from "./NodeSha256MessageProjectionHasher.js";

export interface CreateMessageProjectionContextOptions {
  projector: RuntimeMessageProjector;
  messageSchemaRegistry?: RuntimeMessageSchemaRegistry;
  clock?: MessageProjectionClock;
  logger?: Logger;
  journalPageSize?: number;
  inspectionRetryCount?: number;
  maxLineByteLength?: number;
  lock?: Omit<ConversationMessageFileLockOptions, "logger">;
}

export interface NodeConversationMessageProjectionContextFactoryOptions {
  workspace: WorkspaceStoreLocation;
  journal: ConversationJournalReader;
  logger?: Logger;
  onContextClosed?: (context: NodeConversationMessageProjectionContext) => void;
}

export class NodeConversationMessageProjectionContextFactory {
  private readonly workspace: WorkspaceStoreLocation;
  private readonly journal: ConversationJournalReader;
  private readonly logger: Logger;
  private readonly onContextClosed?: (
    context: NodeConversationMessageProjectionContext,
  ) => void;

  constructor(options: NodeConversationMessageProjectionContextFactoryOptions) {
    this.workspace = options.workspace;
    this.journal = options.journal;
    this.logger = options.logger ?? noopLogger;
    this.onContextClosed = options.onContextClosed;
  }

  create(
    options: CreateMessageProjectionContextOptions,
  ): NodeConversationMessageProjectionContext {
    const logger = (options.logger ?? this.logger).child({
      component: "node_conversation_message_projection_context",
      workspaceId: this.workspace.workspaceId,
      projectorId: options.projector.id,
      projectorVersion: options.projector.version,
    });
    logger.debug("message_projection.context.wiring_started");
    const messageSchemaRegistry =
      options.messageSchemaRegistry ?? createCoreRuntimeMessageSchemaRegistry();
    const hasher = new NodeSha256MessageProjectionHasher();
    const codec = new MessageProjectionRecordCodec({
      hasher,
      messageSchemaRegistry,
    });
    const messages = new JsonlConversationMessageStore({
      workspaceId: this.workspace.workspaceId,
      storeDir: this.workspace.storeDir,
      codec,
      logger,
      ...(options.maxLineByteLength !== undefined
        ? { maxLineByteLength: options.maxLineByteLength }
        : {}),
      ...(options.lock !== undefined ? { lock: options.lock } : {}),
    });
    const materializer = new RuntimeMessageMaterializer({
      idFactory: new Sha256RuntimeMessageIdFactory({ hasher }),
      messageSchemaRegistry,
    });
    const projections = new JournalConversationMessageProjectionService({
      workspaceId: this.workspace.workspaceId,
      journal: this.journal,
      messageFiles: messages,
      projector: options.projector,
      materializer,
      codec,
      logger,
      ...(options.clock !== undefined ? { clock: options.clock } : {}),
      ...(options.journalPageSize !== undefined
        ? { journalPageSize: options.journalPageSize }
        : {}),
      ...(options.inspectionRetryCount !== undefined
        ? { inspectionRetryCount: options.inspectionRetryCount }
        : {}),
    });

    logger.info("message_projection.context.created");
    return new ManagedNodeConversationMessageProjectionContext({
      messages,
      projections,
      logger,
      onClosed: this.onContextClosed,
    });
  }
}

interface ManagedNodeConversationMessageProjectionContextOptions {
  messages: ConversationMessageFileStore;
  projections: ConversationMessageProjectionService;
  logger: Logger;
  onClosed?: (context: NodeConversationMessageProjectionContext) => void;
}

class ManagedNodeConversationMessageProjectionContext
  implements NodeConversationMessageProjectionContext
{
  readonly messages: ConversationMessageFileStore;
  readonly projections: ConversationMessageProjectionService;

  private readonly logger: Logger;
  private readonly onClosed?: (
    context: NodeConversationMessageProjectionContext,
  ) => void;
  private closePromise?: Promise<void>;

  constructor(options: ManagedNodeConversationMessageProjectionContextOptions) {
    this.messages = options.messages;
    this.projections = options.projections;
    this.logger = options.logger;
    this.onClosed = options.onClosed;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    this.logger.debug("message_projection.context.close_started");
    try {
      await this.messages.close();
      this.logger.info("message_projection.context.closed");
    } catch (error) {
      this.logger.error("message_projection.context.close_failed");
      throw error;
    } finally {
      this.onClosed?.(this);
    }
  }
}
