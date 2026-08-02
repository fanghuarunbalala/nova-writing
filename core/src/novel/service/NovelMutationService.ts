/** Routes validated Domain Operations through the owning Draft Writer queue. */
import { noopLogger, type Logger } from "../../observability/index.js";
import { captureNovelDraftSession, type NovelDraftSession } from "../draft/index.js";
import { captureNovelOperation, type NovelOperation } from "../operation/index.js";
import type { NovelDraftOperationReceipt } from "../port/index.js";

export interface NovelMutationWriter {
  enqueue(
    session: NovelDraftSession,
    operation: NovelOperation,
  ): Promise<NovelDraftOperationReceipt>;
}

export interface NovelMutationServiceOptions {
  readonly writer: NovelMutationWriter;
  readonly logger?: Logger;
}

export class NovelMutationService {
  private readonly logger: Logger;

  constructor(private readonly options: NovelMutationServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_mutation_service",
    });
  }

  async execute(
    session: NovelDraftSession,
    operation: NovelOperation,
  ): Promise<NovelDraftOperationReceipt> {
    const capturedSession = captureNovelDraftSession(session);
    const capturedOperation = captureNovelOperation(operation);
    this.logger.debug("novel_mutation.execute.started", {
      novelId: capturedSession.novelId,
      draftSessionId: capturedSession.id,
      operationId: capturedOperation.operationId,
      operationType: capturedOperation.type,
      operationVersion: capturedOperation.operationVersion,
    });
    const receipt = await this.options.writer.enqueue(
      capturedSession,
      capturedOperation,
    );
    this.logger.info("novel_mutation.execute.completed", {
      novelId: capturedSession.novelId,
      draftSessionId: capturedSession.id,
      operationId: capturedOperation.operationId,
      operationType: capturedOperation.type,
      operationVersion: capturedOperation.operationVersion,
      sequence: receipt.sequence,
      status: receipt.status,
    });
    return receipt;
  }
}
