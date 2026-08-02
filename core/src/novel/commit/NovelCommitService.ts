/** Application service freezing a Draft and submitting one canonical Commit. */
import type { NovelDraftSession } from "../draft/index.js";
import type { NovelCommitId, NovelIdentityFactory } from "../identity/index.js";
import type { NovelClock, NovelRevisionFactory } from "../port/index.js";
import type { NovelRevision, NovelTimestamp } from "../version/index.js";
import { NOVEL_COMMIT_PAYLOAD_VERSION } from "./NovelCommitPayload.js";
import type { NovelDraftChangeSetBuilder } from "./NovelDraftChangeSetBuilder.js";
import type { NovelCommitWriter, NovelCommitWriteResult } from "./NovelCommitWriter.js";

export interface NovelCommitServiceOptions<TContext> {
  readonly changeSets: NovelDraftChangeSetBuilder;
  readonly writer: NovelCommitWriter<TContext>;
  readonly identityFactory: Pick<NovelIdentityFactory, "createCommitId">;
  readonly revisionFactory: NovelRevisionFactory;
  readonly clock: NovelClock;
}

export class NovelCommitService<TContext> {
  constructor(private readonly options: NovelCommitServiceOptions<TContext>) {}

  async commit(
    session: NovelDraftSession,
    options: {
      readonly commitId?: NovelCommitId;
      readonly resultRevision?: NovelRevision;
      readonly committedAt?: NovelTimestamp;
    } = {},
  ): Promise<NovelCommitWriteResult> {
    const changeSet = await this.options.changeSets.build(session);
    const payload = {
      payloadVersion: NOVEL_COMMIT_PAYLOAD_VERSION,
      commitId: options.commitId ?? this.options.identityFactory.createCommitId(),
      novelId: changeSet.novelId,
      draftSessionId: changeSet.draftSessionId,
      ownerConversationId: session.ownerConversationId,
      baseRevision: changeSet.baseRevision,
      resultRevision: options.resultRevision ?? this.options.revisionFactory.createRevision(),
      changeSetDigest: changeSet.digest,
      operationCount: changeSet.operationCount,
      committedAt: options.committedAt ?? this.options.clock.now(),
      operations: changeSet.operations,
    };
    return this.options.writer.write({ changeSet, payload });
  }
}
