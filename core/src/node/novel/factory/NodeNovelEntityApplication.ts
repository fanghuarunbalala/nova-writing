/** Composes the Node SQLite Character/Location application slice. */
import {
  CharacterQueryService,
  CharacterService,
  LocationQueryService,
  LocationService,
  NovelDraftOperationWriter,
  NovelDraftChangeSetBuilder,
  NovelCommitService,
  NovelCommitWriter,
  NovelMutationService,
  NovelOperationExecutor,
  NovelOperationRegistry,
  RandomNovelIdentityFactory,
  RandomNovelRevisionFactory,
  SystemNovelClock,
  registerNovelEntityOperationHandlers,
  type NovelClock,
  type NovelEntityMutationContext,
  type NovelId,
  type NovelIdentityFactory,
  type NovelRevisionFactory,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  NodeSha256NovelOperationDigester,
  NodeSha256NovelChangeSetDigester,
  SqliteNovelDraftOperationStore,
  SqliteNovelEntityQueryStore,
  SqliteNovelCommitStore,
  createSqliteNovelEntityMutationContext,
} from "../sqlite/index.js";
import { NodeNovelCommitHistoryStore } from "../history/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";

export interface NodeNovelEntityApplicationOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly identityFactory?: NovelIdentityFactory;
  readonly clock?: NovelClock;
  readonly logger?: Logger;
  readonly revisionFactory?: NovelRevisionFactory;
}

export interface NodeNovelEntityApplication {
  readonly mutations: NovelMutationService;
  readonly characters: CharacterService;
  readonly locations: LocationService;
  readonly characterQueries: CharacterQueryService;
  readonly locationQueries: LocationQueryService;
  readonly changeSets: NovelDraftChangeSetBuilder;
  readonly commits: NovelCommitService<NovelEntityMutationContext>;
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
  const operationDigester = new NodeSha256NovelOperationDigester();
  const executor = new NovelOperationExecutor(registry);
  const writer = new NovelDraftOperationWriter({
    store,
    executor,
    digester: operationDigester,
    clock,
    logger,
  });
  const mutations = new NovelMutationService({ writer, logger });
  const queryStore = new SqliteNovelEntityQueryStore({
    location: options.location,
    novelId: options.novelId,
    logger,
  });

  const changeSets = new NovelDraftChangeSetBuilder({
    store,
    writer,
    operationDigester,
    changeSetDigester: new NodeSha256NovelChangeSetDigester(),
    clock,
    logger,
  });
  const commitWriter = new NovelCommitWriter({
    store: new SqliteNovelCommitStore({
      location: options.location,
      novelId: options.novelId,
      contextFactory: createSqliteNovelEntityMutationContext,
      logger,
    }),
    history: new NodeNovelCommitHistoryStore({
      location: options.location,
      logger,
    }),
    executor,
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
    changeSets,
    commits: new NovelCommitService({
      changeSets,
      writer: commitWriter,
      identityFactory,
      revisionFactory: options.revisionFactory ?? new RandomNovelRevisionFactory(),
      clock,
    }),
  });
}
