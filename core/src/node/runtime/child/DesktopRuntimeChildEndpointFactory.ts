/**
 * Parent child-endpoint factory binding the Runtime persistence RPC handler
 * to the Workspace journal and message stores for each activated Conversation.
 */
import type {
  ConversationCommandService,
  ConversationRuntimeBootstrap,
} from "../../../conversation/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type {
  RuntimeIpcNotificationHandler,
  RuntimeIpcRequestErrorMapper,
  RuntimeIpcRequestHandler,
} from "../../../runtime/ipc/index.js";
import type {
  ConversationJournalReader,
  ConversationJournalService,
  ConversationMessageFileStore,
} from "../../../storage/index.js";
import { ParentRuntimePersistenceHandler } from "../persistence/index.js";
import {
  ParentRuntimeSubagentHandler,
  type ChildSubagentConversationHost,
} from "../subagent/index.js";
import {
  ParentRuntimeChildEndpointFactory,
  type ParentRuntimeChildIdentityFactory,
} from "./ParentRuntimeChildEndpoint.js";
import type {
  RuntimeChildProcessEndpointFactory,
  RuntimeChildProcessEndpointFactoryRequest,
} from "../process/NodeConversationProcessSupervisor.js";
import type { RuntimeChildProcessEndpoint } from "../process/ChildProcessConversationRuntimeHandle.js";

export interface DesktopRuntimeChildPersistence {
  readonly journalReader: ConversationJournalReader;
  readonly journalService: ConversationJournalService;
  readonly messageStore: Pick<ConversationMessageFileStore, "list">;
}

export interface DesktopRuntimeChildPersistenceProvider {
  provide(
    bootstrap: ConversationRuntimeBootstrap,
  ): Promise<DesktopRuntimeChildPersistence>;
}

/**
 * Parent 侧暴露给 child 子代理 manager 的窄视图：host 激活/关闭 + Task 入队。
 * Narrow parent views exposed to the child subagent manager.
 */
export interface DesktopRuntimeChildSubagent {
  readonly host: ChildSubagentConversationHost;
  readonly commandService: ConversationCommandService;
}

export interface DesktopRuntimeChildSubagentProvider {
  provide(
    bootstrap: ConversationRuntimeBootstrap,
  ): Promise<DesktopRuntimeChildSubagent>;
}

export interface DesktopRuntimeChildEndpointFactoryOptions {
  readonly persistenceProvider: DesktopRuntimeChildPersistenceProvider;
  readonly subagentProvider?: DesktopRuntimeChildSubagentProvider;
  readonly sessionIdFactory?: ParentRuntimeChildIdentityFactory;
  readonly notificationHandler?: RuntimeIpcNotificationHandler;
  readonly logger?: Logger;
}

export class DesktopRuntimeChildEndpointFactory
  implements RuntimeChildProcessEndpointFactory
{
  readonly #persistenceProvider: DesktopRuntimeChildPersistenceProvider;
  readonly #subagentProvider?: DesktopRuntimeChildSubagentProvider;
  readonly #sessionIdFactory?: ParentRuntimeChildIdentityFactory;
  readonly #notificationHandler?: RuntimeIpcNotificationHandler;
  readonly #logger: Logger;

  constructor(options: DesktopRuntimeChildEndpointFactoryOptions) {
    this.#persistenceProvider = options.persistenceProvider;
    this.#subagentProvider = options.subagentProvider;
    this.#sessionIdFactory = options.sessionIdFactory;
    this.#notificationHandler = options.notificationHandler;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "desktop_runtime_child_endpoint_factory",
    });
  }

  async connect(
    request: RuntimeChildProcessEndpointFactoryRequest,
  ): Promise<RuntimeChildProcessEndpoint> {
    const conversationId = request.bootstrap.conversation.metadata.id;
    const persistence = await this.#persistenceProvider.provide(
      request.bootstrap,
    );
    const handler = new ParentRuntimePersistenceHandler({
      conversationId,
      journalReader: persistence.journalReader,
      journalService: persistence.journalService,
      messageStore: persistence.messageStore,
      logger: this.#logger,
    });
    this.#logger.debug("desktop_runtime_child_endpoint.persistence_bound", {
      conversationId,
    });
    let requestHandler: RuntimeIpcRequestHandler = handler;
    let requestErrorMapper: RuntimeIpcRequestErrorMapper = handler;
    if (this.#subagentProvider !== undefined) {
      const subagent = await this.#subagentProvider.provide(request.bootstrap);
      const subagentHandler = new ParentRuntimeSubagentHandler({
        host: subagent.host,
        commandService: subagent.commandService,
        journalReader: persistence.journalReader,
        logger: this.#logger,
      });
      requestHandler = compositeRequestHandler(handler, subagentHandler);
      requestErrorMapper = compositeRequestErrorMapper(handler, subagentHandler);
      this.#logger.debug("desktop_runtime_child_endpoint.subagent_bound", {
        conversationId,
      });
    }
    const delegate = new ParentRuntimeChildEndpointFactory({
      requestHandler,
      requestErrorMapper,
      ...(this.#sessionIdFactory === undefined
        ? {}
        : { sessionIdFactory: this.#sessionIdFactory }),
      ...(this.#notificationHandler === undefined
        ? {}
        : { notificationHandler: this.#notificationHandler }),
      logger: this.#logger,
    });
    return delegate.connect(request);
  }
}

/** 按方法前缀把子代理窄 RPC 路由到对应 handler。Routes subagent.* methods to the subagent handler. */
class RuntimeSubagentBoundaryError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Runtime subagent boundary failure");
    this.name = "RuntimeSubagentBoundaryError";
    this.cause = cause;
  }
}

function compositeRequestHandler(
  persistenceHandler: RuntimeIpcRequestHandler,
  subagentHandler: RuntimeIpcRequestHandler,
): RuntimeIpcRequestHandler {
  return {
    handle: async (method, payload, context) => {
      if (method.startsWith("subagent.")) {
        try {
          return await subagentHandler.handle(method, payload, context);
        } catch (error) {
          throw new RuntimeSubagentBoundaryError(error);
        }
      }
      return persistenceHandler.handle(method, payload, context);
    },
  };
}

/** 按错误来源分发脱敏错误映射。Dispatches error mapping by failure origin. */
function compositeRequestErrorMapper(
  persistenceHandler: RuntimeIpcRequestErrorMapper,
  subagentHandler: RuntimeIpcRequestErrorMapper,
): RuntimeIpcRequestErrorMapper {
  return {
    map: (error, context) => {
      if (error instanceof RuntimeSubagentBoundaryError) {
        return subagentHandler.map(error.cause, context);
      }
      return persistenceHandler.map(error, context);
    },
  };
}
