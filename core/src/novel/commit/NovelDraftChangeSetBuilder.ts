/** Freezes one Draft queue and verifies its durable ordered Operation sequence. */
import { noopLogger, type Logger } from "../../observability/index.js";
import { NOVEL_DRAFT_SESSION_STATUS, captureNovelDraftSession, type NovelDraftSession } from "../draft/index.js";
import { NOVEL_INVARIANT_FAILURE, NovelDraftSessionStateError, NovelInvariantViolationError } from "../error/index.js";
import type { NovelOperationDigester, NovelDraftOperationWriter } from "../operation/index.js";
import type { NovelClock, NovelDraftChangeSetStore } from "../port/index.js";
import {
  NOVEL_CHANGE_SET_VERSION,
  captureNovelChangeSet,
  captureNovelChangeSetIdentity,
  type NovelChangeSet,
} from "./NovelChangeSet.js";
import type { NovelChangeSetDigester } from "./NovelChangeSetDigest.js";

export interface NovelDraftChangeSetBuilderOptions {
  readonly store: NovelDraftChangeSetStore;
  readonly writer: Pick<NovelDraftOperationWriter<unknown>, "runExclusive">;
  readonly operationDigester: NovelOperationDigester;
  readonly changeSetDigester: NovelChangeSetDigester;
  readonly clock: NovelClock;
  readonly logger?: Logger;
}

export class NovelDraftChangeSetBuilder {
  private readonly logger: Logger;

  constructor(private readonly options: NovelDraftChangeSetBuilderOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_draft_change_set_builder",
    });
  }

  build(session: NovelDraftSession): Promise<NovelChangeSet> {
    const draft = captureNovelDraftSession(session);
    if (draft.status !== NOVEL_DRAFT_SESSION_STATUS.active) {
      throw new NovelDraftSessionStateError(
        draft.id,
        [NOVEL_DRAFT_SESSION_STATUS.active],
        draft.status,
      );
    }
    return this.options.writer.runExclusive(draft, async () => {
      this.logger.debug("novel_change_set.freeze.started", {
        novelId: draft.novelId,
        draftSessionId: draft.id,
      });
      const source = await this.options.store.readOperationSequence(draft);
      for (const entry of source.operations) {
        const digest = await this.options.operationDigester.digest(entry.operation);
        if (digest !== entry.operationDigest) throw corrupt(draft);
      }
      const identity = captureNovelChangeSetIdentity({
        changeSetVersion: NOVEL_CHANGE_SET_VERSION,
        novelId: draft.novelId,
        baseRevision: draft.baseRevision,
        operationCount: source.operationCount,
        lastOperationSequence: source.lastOperationSequence,
        operations: source.operations,
      });
      const digest = await this.options.changeSetDigester.digest(identity);
      if (source.frozen !== undefined && source.frozen.digest !== digest) {
        throw corrupt(draft);
      }
      const frozen = await this.options.store.freezeChangeSet({
        session: draft,
        expectedOperationCount: source.operationCount,
        expectedLastOperationSequence: source.lastOperationSequence,
        digest,
        frozenAt: source.frozen?.frozenAt ?? this.options.clock.now(),
      });
      if (frozen.digest !== digest) throw corrupt(draft);
      const changeSet = captureNovelChangeSet({
        ...identity,
        draftSessionId: draft.id,
        digest,
        frozenAt: frozen.frozenAt,
      });
      this.logger.info("novel_change_set.freeze.completed", {
        novelId: draft.novelId,
        draftSessionId: draft.id,
        operationCount: changeSet.operationCount,
        lastOperationSequence: changeSet.lastOperationSequence,
      });
      return changeSet;
    });
  }
}

function corrupt(session: NovelDraftSession): NovelInvariantViolationError {
  return new NovelInvariantViolationError(
    NOVEL_INVARIANT_FAILURE.persistenceInvariant,
    session.novelId,
    session.id,
  );
}
