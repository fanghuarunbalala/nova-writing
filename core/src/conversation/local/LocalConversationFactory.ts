/** Creates verified local Conversation Handles without activating Runtime. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { ConversationCommandService } from "../ConversationCommandService.js";
import type { ConversationComposeStateReader } from "../ConversationComposeStateReader.js";
import type { ConversationQueryService } from "../ConversationQueryService.js";
import type { ConversationRuntimePresenceReader } from "../ConversationRuntimePresenceReader.js";
import { LocalConversation } from "./LocalConversation.js";

export interface LocalConversationFactoryOptions {
  queryService: ConversationQueryService;
  commandService: ConversationCommandService;
  runtimePresenceReader: ConversationRuntimePresenceReader;
  /** 可选 compose 会话子状态读取器；缺省时 getComposeState 返回 undefined。 */
  /** Optional compose session sub-state reader; getComposeState returns undefined when absent. */
  composeStateReader?: ConversationComposeStateReader;
  logger?: Logger;
}

export class LocalConversationFactory {
  private readonly queryService: ConversationQueryService;
  private readonly commandService: ConversationCommandService;
  private readonly runtimePresenceReader: ConversationRuntimePresenceReader;
  private readonly composeStateReader?: ConversationComposeStateReader;
  private readonly logger: Logger;

  constructor(options: LocalConversationFactoryOptions) {
    this.queryService = options.queryService;
    this.commandService = options.commandService;
    this.runtimePresenceReader = options.runtimePresenceReader;
    this.composeStateReader = options.composeStateReader;
    this.logger = options.logger ?? noopLogger;
  }

  async open(conversationId: string): Promise<LocalConversation> {
    const snapshot = await this.queryService.getSnapshot(conversationId);
    return new LocalConversation({
      snapshot,
      queryService: this.queryService,
      commandService: this.commandService,
      runtimePresenceReader: this.runtimePresenceReader,
      composeStateReader: this.composeStateReader,
      logger: this.logger,
    });
  }
}
