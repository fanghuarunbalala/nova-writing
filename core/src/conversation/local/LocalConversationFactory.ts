/** Creates verified local Conversation Handles without activating Runtime. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { ConversationCommandService } from "../ConversationCommandService.js";
import type { ConversationQueryService } from "../ConversationQueryService.js";
import type { ConversationRuntimePresenceReader } from "../ConversationRuntimePresenceReader.js";
import { LocalConversation } from "./LocalConversation.js";

export interface LocalConversationFactoryOptions {
  queryService: ConversationQueryService;
  commandService: ConversationCommandService;
  runtimePresenceReader: ConversationRuntimePresenceReader;
  logger?: Logger;
}

export class LocalConversationFactory {
  private readonly queryService: ConversationQueryService;
  private readonly commandService: ConversationCommandService;
  private readonly runtimePresenceReader: ConversationRuntimePresenceReader;
  private readonly logger: Logger;

  constructor(options: LocalConversationFactoryOptions) {
    this.queryService = options.queryService;
    this.commandService = options.commandService;
    this.runtimePresenceReader = options.runtimePresenceReader;
    this.logger = options.logger ?? noopLogger;
  }

  async open(conversationId: string): Promise<LocalConversation> {
    const snapshot = await this.queryService.getSnapshot(conversationId);
    return new LocalConversation({
      snapshot,
      queryService: this.queryService,
      commandService: this.commandService,
      runtimePresenceReader: this.runtimePresenceReader,
      logger: this.logger,
    });
  }
}
