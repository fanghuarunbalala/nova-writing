/**
 * Parent child-endpoint factory binding the Runtime persistence RPC handler
 * to the Workspace journal and message stores for each activated Conversation.
 */
import type {
  ConversationRuntimeBootstrap,
} from "../../../conversation/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type {
  RuntimeIpcNotificationHandler,
} from "../../../runtime/ipc/index.js";
import type {
  ConversationJournalReader,
  ConversationJournalService,
  ConversationMessageFileStore,
} from "../../../storage/index.js";
import { ParentRuntimePersistenceHandler } from "../persistence/index.js";
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

export interface DesktopRuntimeChildEndpointFactoryOptions {
  readonly persistenceProvider: DesktopRuntimeChildPersistenceProvider;
  readonly sessionIdFactory?: ParentRuntimeChildIdentityFactory;
  readonly notificationHandler?: RuntimeIpcNotificationHandler;
  readonly logger?: Logger;
}

export class DesktopRuntimeChildEndpointFactory
  implements RuntimeChildProcessEndpointFactory
{
  readonly #persistenceProvider: DesktopRuntimeChildPersistenceProvider;
  readonly #sessionIdFactory?: ParentRuntimeChildIdentityFactory;
  readonly #notificationHandler?: RuntimeIpcNotificationHandler;
  readonly #logger: Logger;

  constructor(options: DesktopRuntimeChildEndpointFactoryOptions) {
    this.#persistenceProvider = options.persistenceProvider;
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
    const delegate = new ParentRuntimeChildEndpointFactory({
      requestHandler: handler,
      requestErrorMapper: handler,
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
