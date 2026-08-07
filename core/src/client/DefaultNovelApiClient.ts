/** Default client composition: typed API -> ConversationClient -> injected Transport. */
import {
  ConversationClient,
  ConversationProxy,
  type ApiRequestIdFactory,
  type Conversation,
  type ConversationCatalogResult,
  type CreateConversationOptions,
  type GlobalApprovalProjection,
  type ListConversationsOptions,
} from "../conversation/index.js";
import type { InputEvent, InputReceipt } from "../event/index.js";
import { noopLogger, type Logger } from "../observability/index.js";
import type {
  CharacterId,
  LocationId,
  ParagraphId,
  StoryUnitId,
} from "../novel/index.js";
import type { ApiTransport } from "../transport/index.js";
import {
  NovelQueryClient,
  type NovelQueryScope,
} from "./novel/index.js";
import type {
  ConversationApi,
  NovelApiClient,
  NovelContentApi,
} from "./NovelApiClient.js";

export interface DefaultNovelApiClientOptions {
  readonly transport: ApiTransport;
  readonly requestIdFactory?: ApiRequestIdFactory;
  readonly logger?: Logger;
}

export class DefaultNovelApiClient implements NovelApiClient {
  readonly conversations: ConversationApi;
  readonly novel: NovelContentApi;

  constructor(options: DefaultNovelApiClientOptions) {
    const logger = (options.logger ?? noopLogger).child({
      component: "default_novel_api_client",
    });
    const requestIdFactory = options.requestIdFactory ?? generateApiRequestId;
    const client = new ConversationClient({
      transport: options.transport,
      requestIdFactory,
      logger,
    });
    this.conversations = new DefaultConversationApi(client, logger);
    this.novel = createDefaultNovelContentApi(new NovelQueryClient({
      transport: options.transport,
      requestIdFactory,
      logger,
    }));
  }
}

class DefaultConversationApi implements ConversationApi {
  constructor(
    private readonly client: ConversationClient,
    private readonly logger: Logger,
  ) {}

  async create(options: CreateConversationOptions): Promise<Conversation> {
    const snapshot = await this.client.create(options);
    return new ConversationProxy({
      snapshot,
      client: this.client,
      logger: this.logger,
    });
  }

  list(options?: ListConversationsOptions): Promise<ConversationCatalogResult> {
    return this.client.list(options);
  }

  async rename(conversationId: string, title: string): Promise<Conversation> {
    const snapshot = await this.client.rename(conversationId, title);
    return new ConversationProxy({
      snapshot,
      client: this.client,
      logger: this.logger,
    });
  }

  async pin(conversationId: string, pinned: boolean): Promise<Conversation> {
    const snapshot = await this.client.pin(conversationId, pinned);
    return new ConversationProxy({
      snapshot,
      client: this.client,
      logger: this.logger,
    });
  }

  delete(conversationId: string): Promise<void> {
    return this.client.delete(conversationId);
  }

  async open(conversationId: string): Promise<Conversation> {
    const snapshot = await this.client.getSnapshot(conversationId);
    return new ConversationProxy({
      snapshot,
      client: this.client,
      logger: this.logger,
    });
  }

  listApprovals(): Promise<readonly GlobalApprovalProjection[]> {
    return this.client.listApprovals();
  }

  enqueueInput(
    conversationId: string,
    event: InputEvent,
  ): Promise<InputReceipt> {
    return this.client.enqueueInput(conversationId, event);
  }
}

function createDefaultNovelContentApi(client: NovelQueryClient): NovelContentApi {
  return Object.freeze({
    overview: Object.freeze({
      get: (scope: NovelQueryScope) => client.getOverview(scope),
    }),
    outline: Object.freeze({
      get: (scope: NovelQueryScope) => client.getOutline(scope),
      getStoryUnit: (scope: NovelQueryScope, storyUnitId: StoryUnitId) =>
        client.getStoryUnit(scope, storyUnitId),
    }),
    characters: Object.freeze({
      list: (scope: NovelQueryScope) => client.listCharacters(scope),
      get: (scope: NovelQueryScope, characterId: CharacterId) =>
        client.getCharacter(scope, characterId),
    }),
    locations: Object.freeze({
      list: (scope: NovelQueryScope) => client.listLocations(scope),
      get: (scope: NovelQueryScope, locationId: LocationId) =>
        client.getLocation(scope, locationId),
    }),
    paragraphs: Object.freeze({
      getCatalog: (scope: NovelQueryScope) =>
        client.getParagraphCatalog(scope),
      get: (scope: NovelQueryScope, paragraphId: ParagraphId) =>
        client.getParagraph(scope, paragraphId),
    }),
  });
}

function generateApiRequestId(): string {
  return `api_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}
