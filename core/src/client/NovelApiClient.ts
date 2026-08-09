/** Shared headless client entrypoint used by GUI, Web, CLI, and TUI. */
import type {
  Conversation,
  ConversationCatalogResult,
  CreateConversationOptions,
  ListConversationsOptions,
  GlobalApprovalProjection,
} from "../conversation/index.js";
import type { InputEvent, InputReceipt } from "../event/index.js";
import type {
  CharacterId,
  LocationId,
  ParagraphId,
  StoryUnitId,
} from "../novel/index.js";
import type {
  NovelCharacterSnapshot,
  NovelCharactersSnapshot,
  NovelLocationSnapshot,
  NovelLocationsSnapshot,
  NovelOutlineSnapshot,
  NovelOverviewSnapshot,
  NovelParagraphCatalogSnapshot,
  NovelParagraphSnapshot,
  NovelPublicationCatalogSnapshot,
  NovelQueryScope,
  NovelStoryUnitSnapshot,
} from "./novel/index.js";

export interface ConversationApi {
  create(options: CreateConversationOptions): Promise<Conversation>;

  list(options?: ListConversationsOptions): Promise<ConversationCatalogResult>;

  rename(conversationId: string, title: string): Promise<Conversation>;

  pin(conversationId: string, pinned: boolean): Promise<Conversation>;

  delete(conversationId: string): Promise<void>;

  open(conversationId: string): Promise<Conversation>;

  /** 聚合工作区内全部会话的审批。Aggregate approvals across conversations. */
  listApprovals(): Promise<readonly GlobalApprovalProjection[]>;

  /** 向指定会话投递输入事件（审批决策等）。Enqueue an input event to a conversation. */
  enqueueInput(conversationId: string, event: InputEvent): Promise<InputReceipt>;
}

export interface NovelOverviewApi {
  get(scope: NovelQueryScope): Promise<NovelOverviewSnapshot>;
}

export interface NovelOutlineApi {
  get(scope: NovelQueryScope): Promise<NovelOutlineSnapshot>;

  getStoryUnit(
    scope: NovelQueryScope,
    storyUnitId: StoryUnitId,
  ): Promise<NovelStoryUnitSnapshot>;
}

export interface NovelCharacterApi {
  list(scope: NovelQueryScope): Promise<NovelCharactersSnapshot>;

  get(
    scope: NovelQueryScope,
    characterId: CharacterId,
  ): Promise<NovelCharacterSnapshot>;
}

export interface NovelLocationApi {
  list(scope: NovelQueryScope): Promise<NovelLocationsSnapshot>;

  get(
    scope: NovelQueryScope,
    locationId: LocationId,
  ): Promise<NovelLocationSnapshot>;
}

export interface NovelParagraphApi {
  getCatalog(
    scope: NovelQueryScope,
  ): Promise<NovelParagraphCatalogSnapshot>;

  get(
    scope: NovelQueryScope,
    paragraphId: ParagraphId,
  ): Promise<NovelParagraphSnapshot>;
}

export interface NovelPublicationApi {
  getCatalog(
    scope: NovelQueryScope,
  ): Promise<NovelPublicationCatalogSnapshot>;
}

export interface NovelContentApi {
  readonly overview: NovelOverviewApi;
  readonly outline: NovelOutlineApi;
  readonly characters: NovelCharacterApi;
  readonly locations: NovelLocationApi;
  readonly paragraphs: NovelParagraphApi;
  readonly publication: NovelPublicationApi;
}

export interface NovelApiClient {
  readonly conversations: ConversationApi;
  readonly novel: NovelContentApi;
}
