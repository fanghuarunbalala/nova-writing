/** Shared headless client entrypoint used by GUI, Web, CLI, and TUI. */
import type {
  Conversation,
  ConversationCatalogResult,
  CreateConversationOptions,
  ListConversationsOptions,
} from "../conversation/index.js";
import type {
  CharacterId,
  LocationId,
  ManuscriptBlockId,
  StoryUnitId,
} from "../novel/index.js";
import type {
  NovelCharacterSnapshot,
  NovelCharactersSnapshot,
  NovelLocationSnapshot,
  NovelLocationsSnapshot,
  NovelManuscriptBlockSnapshot,
  NovelManuscriptStructureSnapshot,
  NovelOutlineSnapshot,
  NovelOverviewSnapshot,
  NovelQueryScope,
  NovelStoryUnitSnapshot,
} from "./novel/index.js";

export interface ConversationApi {
  create(options: CreateConversationOptions): Promise<Conversation>;

  list(options?: ListConversationsOptions): Promise<ConversationCatalogResult>;

  open(conversationId: string): Promise<Conversation>;
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

export interface NovelManuscriptApi {
  getStructure(
    scope: NovelQueryScope,
  ): Promise<NovelManuscriptStructureSnapshot>;

  getBlock(
    scope: NovelQueryScope,
    blockId: ManuscriptBlockId,
  ): Promise<NovelManuscriptBlockSnapshot>;
}

export interface NovelContentApi {
  readonly overview: NovelOverviewApi;
  readonly outline: NovelOutlineApi;
  readonly characters: NovelCharacterApi;
  readonly locations: NovelLocationApi;
  readonly manuscript: NovelManuscriptApi;
}

export interface NovelApiClient {
  readonly conversations: ConversationApi;
  readonly novel: NovelContentApi;
}
