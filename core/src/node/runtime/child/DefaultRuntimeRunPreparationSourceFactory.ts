/**
 * Production Runtime run preparation source for the desktop child: reads
 * persisted messages through the Runtime persistence RPC and resolves the
 * Manifest-bound system prompt. Advanced projection passes remain outside the
 * child scope and surface stable unsupported failures.
 */
import {
  AgentRuntimeSystemPromptSource,
  ProjectedUserMessageRunPreparationSource,
} from "../../../runtime/index.js";
import type { ConversationMessageFileStore } from "../../../storage/index.js";
import type { ConversationMessageProjectionService } from "../../../storage/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { RuntimeRunPreparationSourceFactory } from "./DesktopRuntimeChildCompositionFactory.js";

export interface DefaultRuntimeRunPreparationSourceFactoryOptions {
  readonly logger?: Logger;
}

export class DefaultRuntimeRunPreparationSourceFactory
  implements RuntimeRunPreparationSourceFactory
{
  readonly #logger: Logger;

  constructor(options: DefaultRuntimeRunPreparationSourceFactoryOptions = {}) {
    this.#logger = (options.logger ?? noopLogger).child({
      component: "default_runtime_run_preparation_source_factory",
    });
  }

  async create({
    configuration,
    bootstrap,
    persistence,
  }: Parameters<RuntimeRunPreparationSourceFactory["create"]>[0]) {
    const conversationId = bootstrap.conversation.metadata.id;
    const source = new ProjectedUserMessageRunPreparationSource({
      conversationId,
      projections: createChildProjectionService(conversationId, persistence),
      messages: {
        list: (query: Parameters<ConversationMessageFileStore["list"]>[0]) =>
          persistence.messages.list(query),
      } as ConversationMessageFileStore,
      systemPromptSource: new AgentRuntimeSystemPromptSource(configuration),
      logger: this.#logger,
    });
    this.#logger.debug("runtime_run_preparation_source.created", {
      conversationId,
    });
    return source;
  }
}

function createChildProjectionService(
  conversationId: string,
  persistence: Parameters<RuntimeRunPreparationSourceFactory["create"]>[0]["persistence"],
): ConversationMessageProjectionService {
  return Object.freeze({
    inspect: async () => {
      throw new TypeError(
        "Runtime child projection inspection is outside the desktop V1 scope",
      );
    },
    synchronize: async (cid: string) => {
      const [messagesPage, journalPage] = await Promise.all([
        persistence.messages.list({
          conversationId: cid,
          afterMessageIndex: 0,
        }),
        persistence.journal.listEvents({
          conversationId: cid,
          anchor: { from: "start" },
          limit: 1,
        }),
      ]);
      return Object.freeze({
        workspaceId: "desktop-child",
        projectorId: "core.conversation-message",
        projectorVersion: "1",
        conversationId: cid,
        operations: Object.freeze([]),
        previousSequence: messagesPage.projectedThroughSequence,
        projectedThroughSequence: messagesPage.projectedThroughSequence,
        journalHighWatermark: journalPage.highWatermark,
        processedEventCount: messagesPage.items.length,
        appendedMessageCount: 0,
      });
    },
    rebuild: async () => {
      throw new TypeError(
        "Runtime child projection rebuild is outside the desktop V1 scope",
      );
    },
  });
}
