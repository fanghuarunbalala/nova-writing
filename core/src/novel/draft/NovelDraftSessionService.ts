/** Coordinates durable Draft lifecycle without exposing Node paths or SQLite. */
import {
  NOVEL_DRAFT_SESSION_STATUS,
  captureNovelConversationId,
  captureNovelDraftSession,
  type NovelDraftSession,
  type NovelDraftSessionStatus,
} from "./NovelDraftSession.js";
import {
  NovelDraftAlreadyActiveError,
  NovelDraftSessionNotFoundError,
  NovelDraftSessionStateError,
} from "../error/index.js";
import type {
  NovelDraftSessionId,
  NovelIdentityFactory,
} from "../identity/index.js";
import type {
  NovelCanonicalStore,
  NovelClock,
  NovelDraftStore,
  NovelSnapshotter,
} from "../port/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";

const RESETTABLE_DRAFT_STATUSES: readonly NovelDraftSessionStatus[] = [
  NOVEL_DRAFT_SESSION_STATUS.active,
  NOVEL_DRAFT_SESSION_STATUS.awaitingApproval,
  NOVEL_DRAFT_SESSION_STATUS.conflicted,
];

const ROLLBACKABLE_DRAFT_STATUSES: readonly NovelDraftSessionStatus[] = [
  NOVEL_DRAFT_SESSION_STATUS.active,
  NOVEL_DRAFT_SESSION_STATUS.awaitingApproval,
  NOVEL_DRAFT_SESSION_STATUS.conflicted,
];

export interface NovelDraftSessionServiceOptions {
  readonly canonicalStore: NovelCanonicalStore;
  readonly draftStore: NovelDraftStore;
  readonly snapshotter: NovelSnapshotter;
  readonly identityFactory: NovelIdentityFactory;
  readonly clock: NovelClock;
  readonly logger?: Logger;
}

export class NovelDraftSessionService {
  private readonly logger: Logger;
  private readonly serializer = new DraftLifecycleSerializer();

  constructor(private readonly options: NovelDraftSessionServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_draft_session_service",
    });
  }

  async startDraft(ownerConversationId: string): Promise<NovelDraftSession> {
    const ownerId = captureNovelConversationId(ownerConversationId);
    const metadata = await this.options.canonicalStore.getMetadata();
    return this.serializer.run(`owner:${ownerId}`, async () => {
      const existing = await this.options.draftStore.getActiveDraftSession(
        metadata.novelId,
        ownerId,
      );
      if (existing !== undefined) {
        throw new NovelDraftAlreadyActiveError(
          metadata.novelId,
          ownerId,
          existing.id,
        );
      }

      const latestMetadata = await this.options.canonicalStore.getMetadata();
      const timestamp = this.options.clock.now();
      const session = captureNovelDraftSession({
        id: this.options.identityFactory.createDraftSessionId(),
        novelId: latestMetadata.novelId,
        ownerConversationId: ownerId,
        baseRevision: latestMetadata.currentRevision,
        status: NOVEL_DRAFT_SESSION_STATUS.active,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.logger.info("novel_draft.start.started", {
        novelId: session.novelId,
        draftSessionId: session.id,
        ownerConversationId: ownerId,
      });

      await this.options.snapshotter.createDraftSnapshot(session);
      try {
        await this.options.draftStore.createDraftSession(session);
      } catch (error) {
        await this.options.snapshotter
          .removeDraftSnapshot(session.novelId, session.id)
          .catch(() => undefined);
        throw error;
      }
      this.logger.info("novel_draft.start.completed", {
        novelId: session.novelId,
        draftSessionId: session.id,
        ownerConversationId: ownerId,
      });
      return session;
    });
  }

  async getActiveDraft(
    ownerConversationId: string,
  ): Promise<NovelDraftSession | undefined> {
    const ownerId = captureNovelConversationId(ownerConversationId);
    const metadata = await this.options.canonicalStore.getMetadata();
    const session = await this.options.draftStore.getActiveDraftSession(
      metadata.novelId,
      ownerId,
    );
    if (session === undefined) return undefined;
    const snapshot = await this.options.snapshotter.inspectDraftSnapshot(
      session.novelId,
      session.id,
    );
    if (
      snapshot === undefined ||
      snapshot.ownerConversationId !== session.ownerConversationId ||
      snapshot.baseRevision !== session.baseRevision
    ) {
      throw new NovelDraftSessionStateError(
        session.id,
        [session.status],
        "unknown",
      );
    }
    return session;
  }

  async resetToMain(
    draftSessionId: NovelDraftSessionId,
  ): Promise<NovelDraftSession> {
    return this.serializer.run(`draft:${draftSessionId}`, async () => {
      const metadata = await this.options.canonicalStore.getMetadata();
      const current = await this.requireDraft(
        metadata.novelId,
        draftSessionId,
      );
      assertDraftState(current, RESETTABLE_DRAFT_STATUSES);
      const resetAt = this.options.clock.now();
      const resetSnapshot = captureNovelDraftSession({
        ...current,
        baseRevision: metadata.currentRevision,
        status: NOVEL_DRAFT_SESSION_STATUS.active,
        updatedAt: resetAt,
      });
      this.logger.info("novel_draft.reset.started", {
        novelId: current.novelId,
        draftSessionId: current.id,
      });
      await this.options.snapshotter.replaceDraftSnapshot(resetSnapshot);
      const updated = await this.options.draftStore.resetDraftSession({
        novelId: current.novelId,
        draftSessionId: current.id,
        expectedBaseRevision: current.baseRevision,
        expectedStatuses: RESETTABLE_DRAFT_STATUSES,
        baseRevision: metadata.currentRevision,
        resetAt,
      });
      this.logger.info("novel_draft.reset.completed", {
        novelId: current.novelId,
        draftSessionId: current.id,
      });
      return updated;
    });
  }

  async rollback(
    draftSessionId: NovelDraftSessionId,
  ): Promise<NovelDraftSession> {
    return this.serializer.run(`draft:${draftSessionId}`, async () => {
      const metadata = await this.options.canonicalStore.getMetadata();
      const current = await this.requireDraft(
        metadata.novelId,
        draftSessionId,
      );
      assertDraftState(current, ROLLBACKABLE_DRAFT_STATUSES);
      this.logger.info("novel_draft.rollback.started", {
        novelId: current.novelId,
        draftSessionId: current.id,
      });
      const rolledBack = await this.options.draftStore.rollbackDraftSession({
        novelId: current.novelId,
        draftSessionId: current.id,
        expectedStatuses: ROLLBACKABLE_DRAFT_STATUSES,
        rolledBackAt: this.options.clock.now(),
      });
      await this.options.snapshotter.removeDraftSnapshot(
        current.novelId,
        current.id,
      );
      this.logger.info("novel_draft.rollback.completed", {
        novelId: current.novelId,
        draftSessionId: current.id,
      });
      return rolledBack;
    });
  }

  private async requireDraft(
    novelId: NovelDraftSession["novelId"],
    draftSessionId: NovelDraftSessionId,
  ): Promise<NovelDraftSession> {
    const session = await this.options.draftStore.getDraftSession(
      novelId,
      draftSessionId,
    );
    if (session === undefined) {
      throw new NovelDraftSessionNotFoundError(draftSessionId);
    }
    return session;
  }
}

function assertDraftState(
  session: NovelDraftSession,
  expectedStatuses: readonly NovelDraftSessionStatus[],
): void {
  if (!expectedStatuses.includes(session.status)) {
    throw new NovelDraftSessionStateError(
      session.id,
      expectedStatuses,
      session.status,
    );
  }
}

class DraftLifecycleSerializer {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
