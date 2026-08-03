/** Composes the complete Node SQLite Novel application through Task N9-E. */
import {
  CharacterQueryService,
  CharacterService,
  LocationQueryService,
  LocationService,
  NovelApprovalService,
  NovelCommitRecoveryService,
  NovelCommitService,
  NovelCommitWriter,
  NovelDraftChangeSetBuilder,
  NovelDraftOperationWriter,
  NovelMutationService,
  NovelOperationExecutor,
  RandomNovelIdentityFactory,
  RandomNovelRevisionFactory,
  StoryOutlineQueryService,
  StoryOutlineService,
  SystemNovelClock,
  createDefaultNovelOperationRegistry,
  type NovelClock,
  type NovelId,
  type NovelIdentityFactory,
  type NovelMutationContext,
  type NovelRevisionFactory,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import { NodeNovelCommitHistoryStore } from "../history/index.js";
import {
  NodeSha256NovelApprovalDigester,
  NodeSha256NovelChangeSetDigester,
  NodeSha256NovelOperationDigester,
  SqliteNovelApprovalStore,
  SqliteNovelCommitStore,
  SqliteNovelDraftOperationStore,
  SqliteNovelEntityQueryStore,
  SqliteNovelLifecycleRecordWriter,
  SqliteNovelOutlineQueryStore,
  createSqliteNovelMutationContext,
} from "../sqlite/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";

export interface NodeNovelApplicationOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly identityFactory?: NovelIdentityFactory;
  readonly clock?: NovelClock;
  readonly logger?: Logger;
  readonly revisionFactory?: NovelRevisionFactory;
  readonly validateCommit?: (context: NovelMutationContext) => void;
  readonly requireApproval?: boolean;
}

export interface NodeNovelApplication {
  readonly mutations: NovelMutationService;
  readonly characters: CharacterService;
  readonly locations: LocationService;
  readonly outline: StoryOutlineService;
  readonly characterQueries: CharacterQueryService;
  readonly locationQueries: LocationQueryService;
  readonly outlineQueries: StoryOutlineQueryService;
  readonly changeSets: NovelDraftChangeSetBuilder;
  readonly commits: NovelCommitService<NovelMutationContext>;
  readonly commitRecovery: NovelCommitRecoveryService<NovelMutationContext>;
  readonly approvals: NovelApprovalService;
}

export function createNodeNovelApplication(
  options: NodeNovelApplicationOptions,
): NodeNovelApplication {
  const logger = (options.logger ?? noopLogger).child({
    component: "node_novel_application",
    workspaceId: options.location.workspaceId,
    novelId: options.novelId,
  });
  const clock = options.clock ?? new SystemNovelClock();
  const identityFactory = options.identityFactory ??
    new RandomNovelIdentityFactory();
  const registry = createDefaultNovelOperationRegistry<NovelMutationContext>();
  const executor = new NovelOperationExecutor(registry);
  const store = new SqliteNovelDraftOperationStore({
    location: options.location,
    novelId: options.novelId,
    contextFactory: createSqliteNovelMutationContext,
    logger,
  });
  const operationDigester = new NodeSha256NovelOperationDigester();
  const writer = new NovelDraftOperationWriter({
    store,
    executor,
    digester: operationDigester,
    clock,
    logger,
  });
  const mutations = new NovelMutationService({ writer, logger });
  const entityQueryStore = new SqliteNovelEntityQueryStore({
    location: options.location,
    novelId: options.novelId,
    logger,
  });
  const outlineQueryStore = new SqliteNovelOutlineQueryStore({
    location: options.location,
    novelId: options.novelId,
    logger,
  });
  const changeSetDigester = new NodeSha256NovelChangeSetDigester();
  const changeSets = new NovelDraftChangeSetBuilder({
    store,
    writer,
    operationDigester,
    changeSetDigester,
    clock,
    logger,
  });
  const commitStore = new SqliteNovelCommitStore({
    location: options.location,
    novelId: options.novelId,
    contextFactory: createSqliteNovelMutationContext,
    logger,
  });
  const history = new NodeNovelCommitHistoryStore({
    location: options.location,
    logger,
  });
  const approvals = new NovelApprovalService({
    store: new SqliteNovelApprovalStore({
      location: options.location,
      novelId: options.novelId,
      logger,
    }),
    digester: new NodeSha256NovelApprovalDigester(),
    clock,
    logger,
  });
  const commitWriter = new NovelCommitWriter({
    store: commitStore,
    history,
    executor,
    validate: options.validateCommit,
    ...(options.requireApproval ? { approvalVerifier: approvals } : {}),
    logger,
  });
  logger.info("novel_application.created", {});
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
    outline: new StoryOutlineService({
      mutations,
      identityFactory,
      logger,
    }),
    characterQueries: new CharacterQueryService(entityQueryStore),
    locationQueries: new LocationQueryService(entityQueryStore),
    outlineQueries: new StoryOutlineQueryService(outlineQueryStore),
    changeSets,
    approvals,
    commits: new NovelCommitService({
      changeSets,
      writer: commitWriter,
      identityFactory,
      revisionFactory: options.revisionFactory ?? new RandomNovelRevisionFactory(),
      clock,
    }),
    commitRecovery: new NovelCommitRecoveryService({
      writer: commitWriter,
      commitStore,
      history,
      draftStore: store,
      operationDigester,
      changeSetDigester,
      lifecycleWriter: new SqliteNovelLifecycleRecordWriter(
        options.location,
        options.novelId,
      ),
      logger,
    }),
  });
}
