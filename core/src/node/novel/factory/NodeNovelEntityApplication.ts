/** Composes the Node SQLite Character/Location application slice. */
import {
  CharacterQueryService,
  CharacterService,
  LocationQueryService,
  LocationService,
  NovelDraftOperationWriter,
  NovelMutationService,
  NovelOperationExecutor,
  NovelOperationRegistry,
  RandomNovelIdentityFactory,
  SystemNovelClock,
  registerNovelEntityOperationHandlers,
  type NovelClock,
  type NovelEntityMutationContext,
  type NovelId,
  type NovelIdentityFactory,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  NodeSha256NovelOperationDigester,
  SqliteNovelDraftOperationStore,
  SqliteNovelEntityQueryStore,
  createSqliteNovelEntityMutationContext,
} from "../sqlite/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";

export interface NodeNovelEntityApplicationOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly identityFactory?: NovelIdentityFactory;
  readonly clock?: NovelClock;
  readonly logger?: Logger;
}

export interface NodeNovelEntityApplication {
  readonly mutations: NovelMutationService;
  readonly characters: CharacterService;
  readonly locations: LocationService;
  readonly characterQueries: CharacterQueryService;
  readonly locationQueries: LocationQueryService;
}

export function createNodeNovelEntityApplication(
  options: NodeNovelEntityApplicationOptions,
): NodeNovelEntityApplication {
  const logger = (options.logger ?? noopLogger).child({
    component: "node_novel_entity_application",
    workspaceId: options.location.workspaceId,
    novelId: options.novelId,
  });
  const clock = options.clock ?? new SystemNovelClock();
  const identityFactory = options.identityFactory ??
    new RandomNovelIdentityFactory();
  const registry = new NovelOperationRegistry<NovelEntityMutationContext>();
  registerNovelEntityOperationHandlers(registry);
  const store = new SqliteNovelDraftOperationStore({
    location: options.location,
    novelId: options.novelId,
    contextFactory: createSqliteNovelEntityMutationContext,
    logger,
  });
  const writer = new NovelDraftOperationWriter({
    store,
    executor: new NovelOperationExecutor(registry),
    digester: new NodeSha256NovelOperationDigester(),
    clock,
    logger,
  });
  const mutations = new NovelMutationService({ writer, logger });
  const queryStore = new SqliteNovelEntityQueryStore({
    location: options.location,
    novelId: options.novelId,
    logger,
  });

  logger.info("novel_entity_application.created", {});
  return Object.freeze({
    mutations,
    characters: new CharacterService({
      mutations,
      identityFactory,
      clock,
      logger,
    }),
    locations: new LocationService({
      mutations,
      identityFactory,
      clock,
      logger,
    }),
    characterQueries: new CharacterQueryService(queryStore),
    locationQueries: new LocationQueryService(queryStore),
  });
}
