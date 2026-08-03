/** Discovers recovered Novel staging Outboxes and cleans terminal staging after delivery. */
import {
  NovelOutboxDispatchCoordinator,
  captureNovelDraftSessionId,
  captureNovelId,
  isTerminalNovelDraftStatus,
  type NovelDraftSession,
  type NovelDraftStore,
  type NovelId,
  type NovelLifecycleOutputPublisher,
  type NovelOutboxCoordinatedDispatchResult,
  type NovelOutboxStore,
  type NovelRebaseCandidateStore,
  type NovelResolvedRebaseCandidateStore,
  type NovelSnapshotter,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import { SqliteNovelOutboxStore } from "../sqlite/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";

export interface NodeNovelOutboxStoreFactory {
  openCanonical(options: {
    readonly location: NodeNovelStoreLocation;
    readonly novelId: NovelId;
    readonly logger?: Logger;
  }): Promise<NodeNovelOutboxStore>;
  openDraft(options: {
    readonly location: NodeNovelStoreLocation;
    readonly session: NovelDraftSession;
    readonly logger?: Logger;
  }): Promise<NodeNovelOutboxStore>;
}

export interface NodeNovelOutboxStore extends NovelOutboxStore {
  close(): Promise<void>;
}

export interface NodeNovelOutboxRecoveryRunnerOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly draftStore: Pick<NovelDraftStore, "listDraftSessions">;
  readonly candidateStore: Pick<NovelRebaseCandidateStore, "listCandidates">;
  readonly resolvedCandidateStore: Pick<
    NovelResolvedRebaseCandidateStore,
    "listResolvedCandidates"
  >;
  readonly snapshotter: Pick<
    NovelSnapshotter,
    "listDraftSnapshotIds" | "removeDraftSnapshot"
  >;
  readonly publisher: NovelLifecycleOutputPublisher;
  readonly storeFactory?: NodeNovelOutboxStoreFactory;
  readonly logger?: Logger;
}

export type NodeNovelOutboxRecoveryResult =
  NovelOutboxCoordinatedDispatchResult & {
    readonly removedTerminalSnapshotCount: number;
  };

export class NodeNovelOutboxRecoveryRunner {
  private readonly novelId: NovelId;
  private readonly factory: NodeNovelOutboxStoreFactory;
  private readonly logger: Logger;

  constructor(private readonly options: NodeNovelOutboxRecoveryRunnerOptions) {
    this.novelId = captureNovelId(options.novelId);
    this.factory = options.storeFactory ?? DEFAULT_STORE_FACTORY;
    this.logger = (options.logger ?? noopLogger).child({
      component: "node_novel_outbox_recovery_runner",
      workspaceId: options.location.workspaceId,
      novelId: this.novelId,
    });
  }

  async dispatchPending(): Promise<NodeNovelOutboxRecoveryResult> {
    const [sessions, candidates, resolvedCandidates, snapshotIds] =
      await Promise.all([
        this.options.draftStore.listDraftSessions(this.novelId),
        this.options.candidateStore.listCandidates(this.novelId),
        this.options.resolvedCandidateStore.listResolvedCandidates(this.novelId),
        this.options.snapshotter.listDraftSnapshotIds(this.novelId),
      ]);
    const sessionsById = new Map<string, NovelDraftSession>();
    for (const session of [
      ...sessions,
      ...candidates.map((candidate) => candidate.session),
      ...resolvedCandidates.map((candidate) => candidate.session),
    ]) {
      sessionsById.set(session.id, session);
    }
    const stagingSessions = snapshotIds.flatMap((id) => {
      const session = sessionsById.get(id);
      return session === undefined ? [] : [session];
    });
    const terminalSnapshotIds = sessions
      .filter((session) =>
        isTerminalNovelDraftStatus(session.status) &&
        snapshotIds.includes(session.id)
      )
      .map((session) => session.id);
    const stores: NodeNovelOutboxStore[] = [];
    this.logger.info("novel_outbox_recovery.open.started", {
      stagingSourceCount: stagingSessions.length,
      terminalSnapshotCount: terminalSnapshotIds.length,
    });
    try {
      stores.push(await this.factory.openCanonical({
        location: this.options.location,
        novelId: this.novelId,
        logger: this.options.logger,
      }));
      for (const session of stagingSessions) {
        stores.push(await this.factory.openDraft({
          location: this.options.location,
          session,
          logger: this.options.logger,
        }));
      }
      const dispatch = await new NovelOutboxDispatchCoordinator({
        stores,
        publisher: this.options.publisher,
        logger: this.options.logger,
      }).dispatchPending();
      await closeStores(stores);
      stores.length = 0;
      for (const draftSessionId of terminalSnapshotIds) {
        await this.options.snapshotter.removeDraftSnapshot(
          this.novelId,
          captureNovelDraftSessionId(draftSessionId),
        );
      }
      this.logger.info("novel_outbox_recovery.completed", {
        sourceCount: dispatch.sourceResults.length,
        publishedCount: dispatch.recordedCount + dispatch.duplicateCount,
        removedTerminalSnapshotCount: terminalSnapshotIds.length,
      });
      return Object.freeze({
        ...dispatch,
        removedTerminalSnapshotCount: terminalSnapshotIds.length,
      });
    } finally {
      await closeStores(stores).catch(() => undefined);
    }
  }
}

const DEFAULT_STORE_FACTORY: NodeNovelOutboxStoreFactory = {
  openCanonical: (options) => SqliteNovelOutboxStore.openCanonical(options),
  openDraft: (options) => SqliteNovelOutboxStore.openDraft(options),
};

async function closeStores(
  stores: readonly NodeNovelOutboxStore[],
): Promise<void> {
  for (const store of [...stores].reverse()) await store.close();
}
