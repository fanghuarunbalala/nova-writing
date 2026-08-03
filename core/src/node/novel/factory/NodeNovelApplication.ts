/** Composes the Node SQLite Novel application including the Publication slice. */
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
  NovelRebaseService,
  NovelResolutionApplicationPlanBuilder,
  NovelResolvedRebasePromotionService,
  NovelResolvedRebaseService,
  RandomNovelIdentityFactory,
  RandomNovelRevisionFactory,
  PublicationQueryService,
  PublicationService,
  StoryOutlineQueryService,
  StoryOutlineService,
  SystemNovelClock,
  createDefaultNovelOperationRegistry,
  type NovelClock,
  type NovelCanonicalStore,
  type NovelDraftStore,
  type NovelId,
  type NovelIdentityFactory,
  type NovelKeepDraftOperationPlanner,
  type NovelMutationContext,
  type NovelRevisionFactory,
  type NovelSnapshotter,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import { NodeNovelCommitHistoryStore } from "../history/index.js";
import {
  NodeSha256NovelApprovalDigester,
  NodeSha256NovelChangeSetDigester,
  NodeSha256NovelConflictDigester,
  NodeSha256NovelOperationDigester,
  NodeSha256NovelResolutionApplicationPlanDigester,
  SqliteNovelApprovalStore,
  SqliteNovelCommitStore,
  SqliteNovelDraftOperationStore,
  SqliteNovelEntityQueryStore,
  SqliteNovelLifecycleRecordWriter,
  SqliteNovelOutlineQueryStore,
  SqliteNovelPublicationQueryStore,
  SqliteNovelConflictStore,
  SqliteNovelRebaseCandidateStore,
  SqliteNovelResolutionApplicationPlanStore,
  SqliteNovelResolvedRebaseCandidateStore,
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
  readonly publication: PublicationService;
  readonly characterQueries: CharacterQueryService;
  readonly locationQueries: LocationQueryService;
  readonly outlineQueries: StoryOutlineQueryService;
  readonly publicationQueries: PublicationQueryService;
  readonly changeSets: NovelDraftChangeSetBuilder;
  readonly commits: NovelCommitService<NovelMutationContext>;
  readonly commitRecovery: NovelCommitRecoveryService<NovelMutationContext>;
  readonly approvals: NovelApprovalService;
  openRebase(options: NodeNovelRebaseOpenOptions): Promise<NodeNovelRebaseServices>;
}

export interface NodeNovelRebaseOpenOptions {
  readonly canonicalStore: NovelCanonicalStore;
  readonly draftStore: NovelDraftStore;
  readonly snapshotter: NovelSnapshotter;
  readonly keepDraftPlanner: NovelKeepDraftOperationPlanner;
}

export interface NodeNovelRebaseServices {
  readonly rebases: NovelRebaseService<NovelMutationContext>;
  readonly resolutionPlans: NovelResolutionApplicationPlanBuilder;
  readonly resolvedRebases: NovelResolvedRebaseService<NovelMutationContext>;
  readonly promotions: NovelResolvedRebasePromotionService;
  readonly candidateStore: SqliteNovelRebaseCandidateStore;
  readonly conflictStore: SqliteNovelConflictStore;
  readonly planStore: SqliteNovelResolutionApplicationPlanStore;
  readonly resolvedCandidateStore: SqliteNovelResolvedRebaseCandidateStore;
  close(): Promise<void>;
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
  const publicationQueryStore = new SqliteNovelPublicationQueryStore({
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
    publication: new PublicationService({
      mutations,
      identityFactory,
      logger,
    }),
    characterQueries: new CharacterQueryService(entityQueryStore),
    locationQueries: new LocationQueryService(entityQueryStore),
    outlineQueries: new StoryOutlineQueryService(outlineQueryStore),
    publicationQueries: new PublicationQueryService(publicationQueryStore),
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
    async openRebase(rebaseOptions: NodeNovelRebaseOpenOptions) {
      const candidateStore = await SqliteNovelRebaseCandidateStore.open({
        location: options.location,
        novelId: options.novelId,
        logger,
      });
      let resolvedCandidateStore: SqliteNovelResolvedRebaseCandidateStore | undefined;
      try {
        const openedResolvedCandidateStore = await SqliteNovelResolvedRebaseCandidateStore.open({
          location: options.location,
          novelId: options.novelId,
          logger,
        });
        resolvedCandidateStore = openedResolvedCandidateStore;
        const conflictStore = new SqliteNovelConflictStore({
          location: options.location,
          novelId: options.novelId,
          logger,
        });
        const rebases = new NovelRebaseService({
          canonicalStore: rebaseOptions.canonicalStore,
          draftStore: rebaseOptions.draftStore,
          snapshotter: rebaseOptions.snapshotter,
          candidateStore,
          conflictStore,
          conflictDigester: new NodeSha256NovelConflictDigester({
            location: options.location,
            novelId: options.novelId,
          }),
          operationStore: store,
          writer,
          executor,
          operationDigester,
          identityFactory,
          clock,
          logger,
          approvalInvalidator: approvals,
        });
        const planStore = new SqliteNovelResolutionApplicationPlanStore({
          location: options.location,
          novelId: options.novelId,
          logger,
        });
        const resolutionPlans = new NovelResolutionApplicationPlanBuilder({
          draftStore: rebaseOptions.draftStore,
          operationStore: store,
          conflictStore,
          keepDraftPlanner: rebaseOptions.keepDraftPlanner,
          operationDigester,
          planDigester: new NodeSha256NovelResolutionApplicationPlanDigester(),
          planStore,
          clock,
          logger,
        });
        const resolvedRebases = new NovelResolvedRebaseService({
          canonicalStore: rebaseOptions.canonicalStore,
          snapshotter: rebaseOptions.snapshotter,
          operationStore: store,
          executor,
          planStore,
          resolvedCandidateStore: openedResolvedCandidateStore,
          identityFactory,
          clock,
          logger,
        });
        const promotions = new NovelResolvedRebasePromotionService({
          store: openedResolvedCandidateStore,
          clock,
          logger,
        });
        return Object.freeze({
          rebases,
          resolutionPlans,
          resolvedRebases,
          promotions,
          candidateStore,
          conflictStore,
          planStore,
          resolvedCandidateStore: openedResolvedCandidateStore,
          async close() {
            await openedResolvedCandidateStore.close();
            await candidateStore.close();
          },
        });
      } catch (error) {
        await resolvedCandidateStore?.close().catch(() => undefined);
        await candidateStore.close().catch(() => undefined);
        throw error;
      }
    },
  });
}
