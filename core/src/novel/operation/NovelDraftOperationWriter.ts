/** Serializes atomic Draft Operation writes while allowing independent Drafts. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  NOVEL_DRAFT_SESSION_STATUS,
  type NovelDraftSession,
} from "../draft/index.js";
import { NovelDraftSessionStateError } from "../error/index.js";
import type { NovelClock } from "../port/index.js";
import {
  captureNovelOperation,
  type NovelOperation,
} from "./NovelOperation.js";
import type { NovelOperationDigester } from "./NovelOperationDigest.js";
import type { NovelOperationExecutor } from "./NovelOperationRegistry.js";
import type {
  NovelDraftOperationReceipt,
  NovelDraftOperationStore,
} from "../port/NovelDraftOperationStore.js";

export interface NovelDraftOperationWriterOptions<TContext> {
  readonly store: NovelDraftOperationStore<TContext>;
  readonly executor: NovelOperationExecutor<TContext>;
  readonly digester: NovelOperationDigester;
  readonly clock: NovelClock;
  readonly logger?: Logger;
}

export class NovelDraftOperationWriter<TContext> {
  private readonly serializer = new DraftOperationSerializer();
  private readonly logger: Logger;

  constructor(private readonly options: NovelDraftOperationWriterOptions<TContext>) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_draft_operation_writer",
    });
  }

  enqueue(
    session: NovelDraftSession,
    operation: NovelOperation,
  ): Promise<NovelDraftOperationReceipt> {
    if (session.status !== NOVEL_DRAFT_SESSION_STATUS.active) {
      throw new NovelDraftSessionStateError(
        session.id,
        [NOVEL_DRAFT_SESSION_STATUS.active],
        session.status,
      );
    }
    const captured = captureNovelOperation(operation);
    return this.serializer.run(session.id, async () => {
      this.logger.debug("novel_draft_operation.write.started", {
        novelId: session.novelId,
        draftSessionId: session.id,
        operationId: captured.operationId,
        operationType: captured.type,
        operationVersion: captured.operationVersion,
      });
      try {
        const digest = await this.options.digester.digest(captured);
        const receipt = await this.options.store.appendOperation({
          session,
          operation: captured,
          digest,
          recordedAt: this.options.clock.now(),
          apply: (context) =>
            this.options.executor.executeSynchronous(context, captured),
        });
        this.logger.info("novel_draft_operation.write.completed", {
          novelId: session.novelId,
          draftSessionId: session.id,
          operationId: captured.operationId,
          operationType: captured.type,
          operationVersion: captured.operationVersion,
          sequence: receipt.sequence,
          status: receipt.status,
        });
        return receipt;
      } catch (error) {
        this.logger.info("novel_draft_operation.write.failed", {
          novelId: session.novelId,
          draftSessionId: session.id,
          operationId: captured.operationId,
          operationType: captured.type,
          operationVersion: captured.operationVersion,
        });
        throw error;
      }
    });
  }
}

class DraftOperationSerializer {
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
