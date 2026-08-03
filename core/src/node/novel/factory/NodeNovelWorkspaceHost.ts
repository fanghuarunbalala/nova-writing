/** Opens one Workspace-owned Novel application, runs startup recovery, and owns durable stores. */
import {
  NovelDraftRecoveryService,
  NovelDraftSessionService,
  NovelRebaseRecoveryService,
  RandomNovelIdentityFactory,
  SystemNovelClock,
  canonicalNovelReadScope,
  type EntityProfileReadinessPolicy,
  type NovelCanonicalMetadata,
  type NovelClock,
  type NovelIdentityFactory,
  type NovelLifecycleOutputPublisher,
  type NovelRecoveryResult,
  type NovelRevisionFactory,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { WorkspaceStoreLocation } from "../../../storage/index.js";
import {
  SqliteNovelCanonicalStore,
  SqliteNovelDraftOperationStore,
  SqliteNovelDraftStore,
  SqliteNovelLifecycleRecordWriter,
  SqliteNovelRebaseCandidateStore,
  SqliteNovelResolutionApplicationPlanStore,
  SqliteNovelResolvedRebaseCandidateStore,
  SqliteNovelSnapshotter,
  createSqliteNovelMutationContext,
} from "../sqlite/index.js";
import { NodeNovelStoreLocator } from "../workspace/index.js";
import {
  createNodeNovelApplication,
  type NodeNovelApplication,
} from "./NodeNovelApplication.js";
import { NodeNovelOutboxRecoveryRunner } from "./NodeNovelOutboxRecoveryRunner.js";
import { createNodeNovelProjectionRecoveryStage } from "./NodeNovelProjectionRecoveryStage.js";
import { createNodeNovelRecoveryApplication } from "./NodeNovelRecoveryApplication.js";

export interface NodeNovelWorkspaceHostOptions {
  readonly workspace: WorkspaceStoreLocation;
  readonly lifecyclePublisher: NovelLifecycleOutputPublisher;
  readonly readinessPolicy: EntityProfileReadinessPolicy;
  readonly identityFactory?: NovelIdentityFactory;
  readonly revisionFactory?: NovelRevisionFactory;
  readonly clock?: NovelClock;
  readonly requireApproval?: boolean;
  readonly logger?: Logger;
}

export class NodeNovelWorkspaceHost {
  readonly application: NodeNovelApplication;
  readonly drafts: NovelDraftSessionService;
  readonly recoveryResult: NovelRecoveryResult;

  private closePromise?: Promise<void>;

  private constructor(
    readonly workspaceId: string,
    readonly novelId: NovelCanonicalMetadata["novelId"],
    application: NodeNovelApplication,
    drafts: NovelDraftSessionService,
    recoveryResult: NovelRecoveryResult,
    private readonly canonicalStore: SqliteNovelCanonicalStore,
    private readonly draftStore: SqliteNovelDraftStore,
    private readonly logger: Logger,
  ) {
    this.application = application;
    this.drafts = drafts;
    this.recoveryResult = recoveryResult;
  }

  static async open(
    options: NodeNovelWorkspaceHostOptions,
  ): Promise<NodeNovelWorkspaceHost> {
    const logger = (options.logger ?? noopLogger).child({
      component: "node_novel_workspace_host",
      workspaceId: options.workspace.workspaceId,
    });
    const clock = options.clock ?? new SystemNovelClock();
    const identityFactory =
      options.identityFactory ?? new RandomNovelIdentityFactory();
    let canonicalStore: SqliteNovelCanonicalStore | undefined;
    let draftStore: SqliteNovelDraftStore | undefined;
    let candidateStore: SqliteNovelRebaseCandidateStore | undefined;
    let resolvedCandidateStore: SqliteNovelResolvedRebaseCandidateStore | undefined;

    logger.info("node_novel_workspace_host.open_started");
    try {
      const location = await new NodeNovelStoreLocator().resolve(options.workspace);
      canonicalStore = await SqliteNovelCanonicalStore.open({
        location,
        identityFactory,
        clock,
        ...(options.revisionFactory !== undefined
          ? { revisionFactory: options.revisionFactory }
          : {}),
        logger,
      });
      const metadata = await canonicalStore.getMetadata();
      draftStore = await SqliteNovelDraftStore.open({
        location,
        novelId: metadata.novelId,
        logger,
      });
      const snapshotter = new SqliteNovelSnapshotter({
        location,
        novelId: metadata.novelId,
        logger,
      });
      const drafts = new NovelDraftSessionService({
        canonicalStore,
        draftStore,
        snapshotter,
        identityFactory,
        clock,
        logger,
      });
      const application = createNodeNovelApplication({
        location,
        novelId: metadata.novelId,
        identityFactory,
        clock,
        ...(options.revisionFactory !== undefined
          ? { revisionFactory: options.revisionFactory }
          : {}),
        requireApproval: options.requireApproval ?? true,
        logger,
      });
      candidateStore = await SqliteNovelRebaseCandidateStore.open({
        location,
        novelId: metadata.novelId,
        logger,
      });
      resolvedCandidateStore =
        await SqliteNovelResolvedRebaseCandidateStore.open({
          location,
          novelId: metadata.novelId,
          logger,
        });
      const operationStore = new SqliteNovelDraftOperationStore({
        location,
        novelId: metadata.novelId,
        contextFactory: createSqliteNovelMutationContext,
        logger,
      });
      const rebaseRecovery = new NovelRebaseRecoveryService({
        draftStore,
        snapshotter,
        candidateStore,
        resolvedCandidateStore,
        operationStore,
        resolutionPlanStore: new SqliteNovelResolutionApplicationPlanStore({
          location,
          novelId: metadata.novelId,
          logger,
        }),
        logger,
      });
      const draftRecovery = new NovelDraftRecoveryService({
        canonicalStore,
        draftStore,
        snapshotter,
        rebaseCandidateStore: candidateStore,
        resolvedRebaseCandidateStore: resolvedCandidateStore,
        clock,
        lifecycleWriter: new SqliteNovelLifecycleRecordWriter(
          location,
          metadata.novelId,
        ),
        logger,
      });
      const recovery = createNodeNovelRecoveryApplication({
        novelId: metadata.novelId,
        commitRecovery: application.commitRecovery,
        rebaseRecovery,
        draftRecovery,
        projectionRecovery: createNodeNovelProjectionRecoveryStage({
          location,
          novelId: metadata.novelId,
          scope: canonicalNovelReadScope,
          clock,
          readinessPolicy: options.readinessPolicy,
          logger,
        }),
        outboxRecovery: new NodeNovelOutboxRecoveryRunner({
          location,
          novelId: metadata.novelId,
          draftStore,
          candidateStore,
          resolvedCandidateStore,
          snapshotter,
          publisher: options.lifecyclePublisher,
          logger,
        }),
        logger,
      });
      const recoveryResult = await recovery.recover();
      await resolvedCandidateStore.close();
      resolvedCandidateStore = undefined;
      await candidateStore.close();
      candidateStore = undefined;
      logger.info("node_novel_workspace_host.open_completed", {
        novelId: metadata.novelId,
        recoveryPhaseCount: recoveryResult.phases.length,
      });
      return new NodeNovelWorkspaceHost(
        metadata.workspaceId,
        metadata.novelId,
        application,
        drafts,
        recoveryResult,
        canonicalStore,
        draftStore,
        logger.child({ novelId: metadata.novelId }),
      );
    } catch {
      await settleClose(() => resolvedCandidateStore?.close());
      await settleClose(() => candidateStore?.close());
      await settleClose(() => draftStore?.close());
      await settleClose(() => canonicalStore?.close());
      logger.info("node_novel_workspace_host.open_failed");
      throw new NodeNovelWorkspaceHostOpenError();
    }
  }

  getMetadata(): Promise<NovelCanonicalMetadata> {
    return this.canonicalStore.getMetadata();
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    this.logger.info("node_novel_workspace_host.close_started");
    const failures: string[] = [];
    await closeStage("draft_store", () => this.draftStore.close(), failures);
    await closeStage("canonical_store", () => this.canonicalStore.close(), failures);
    this.logger.info("node_novel_workspace_host.close_completed", {
      failureCount: failures.length,
    });
    if (failures.length > 0) {
      throw new NodeNovelWorkspaceHostCloseError(failures);
    }
  }
}

export class NodeNovelWorkspaceHostOpenError extends Error {
  readonly code = "NODE_NOVEL_WORKSPACE_HOST_OPEN_FAILED";

  constructor() {
    super("Node Novel Workspace Host failed to open");
    this.name = "NodeNovelWorkspaceHostOpenError";
  }
}

export class NodeNovelWorkspaceHostCloseError extends Error {
  readonly code = "NODE_NOVEL_WORKSPACE_HOST_CLOSE_FAILED";
  readonly failedStages: readonly string[];

  constructor(failedStages: readonly string[]) {
    super("Node Novel Workspace Host failed to close cleanly");
    this.name = "NodeNovelWorkspaceHostCloseError";
    this.failedStages = Object.freeze([...failedStages]);
  }
}

async function closeStage(
  stage: string,
  close: () => Promise<void>,
  failures: string[],
): Promise<void> {
  try {
    await close();
  } catch {
    failures.push(stage);
  }
}

async function settleClose(
  close: () => Promise<void> | undefined,
): Promise<void> {
  try {
    await close();
  } catch {
    return;
  }
}
