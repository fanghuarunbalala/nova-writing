/** Default client composition: typed API -> ConversationClient -> injected Transport. */
import {
  ConversationClient,
  ConversationProxy,
  type ApiRequestIdFactory,
  type Conversation,
} from "../conversation/index.js";
import { noopLogger, type Logger } from "../observability/index.js";
import type { ApiTransport } from "../transport/index.js";
import type { ConversationApi, NovelApiClient } from "./NovelApiClient.js";

export interface DefaultNovelApiClientOptions {
  readonly transport: ApiTransport;
  readonly requestIdFactory?: ApiRequestIdFactory;
  readonly logger?: Logger;
}

export class DefaultNovelApiClient implements NovelApiClient {
  readonly conversations: ConversationApi;

  constructor(options: DefaultNovelApiClientOptions) {
    const logger = (options.logger ?? noopLogger).child({
      component: "default_novel_api_client",
    });
    const client = new ConversationClient({
      transport: options.transport,
      ...(options.requestIdFactory !== undefined
        ? { requestIdFactory: options.requestIdFactory }
        : {}),
      logger,
    });
    this.conversations = new DefaultConversationApi(client, logger);
  }
}

class DefaultConversationApi implements ConversationApi {
  constructor(
    private readonly client: ConversationClient,
    private readonly logger: Logger,
  ) {}

  async open(conversationId: string): Promise<Conversation> {
    const snapshot = await this.client.getSnapshot(conversationId);
    return new ConversationProxy({
      snapshot,
      client: this.client,
      logger: this.logger,
    });
  }
}
