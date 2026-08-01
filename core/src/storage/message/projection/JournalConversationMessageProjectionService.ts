/**
 * Journal-backed implementation of inspection, catch-up, repair, and rebuild.
 * It remains platform-neutral and depends only on Storage and Runtime ports.
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { RuntimeMessageProjector } from "../../../runtime/index.js";
import type { ConversationJournalReader } from "../../journal/index.js";
import type {
  ConversationMessageFileStore,
  LockedConversationMessageFile,
  MessageProjectionFileScan,
} from "../file/index.js";
import type {
  MessageProjectionCheckpointRecord,
  MessageProjectionHeaderRecord,
  MessageProjectionRecordCodec,
  MessageProjectionSequenceState,
} from "../protocol/index.js";
import type {
  ConversationMessageProjectionService,
  MessageProjectionOperationOptions,
} from "./ConversationMessageProjectionService.js";
import { throwIfMessageProjectionAborted } from "./MessageProjectionAbort.js";
import {
  MessageProjectionBatchProjector,
  type MessageProjectionBatchProjectorOptions,
} from "./MessageProjectionBatchProjector.js";
import {
  SystemMessageProjectionClock,
  type MessageProjectionClock,
} from "./MessageProjectionClock.js";
import {
  MessageProjectionJournalPager,
  type MessageProjectionRangeResult,
} from "./MessageProjectionJournalPager.js";
import type {
  MessageProjectionInspection,
  MessageProjectionMaintenanceOperation,
  MessageProjectionMaintenanceResult,
  MessageProjectionRebuildReason,
} from "./MessageProjectionMaintenance.js";
import {
  MessageProjectionInvariantError,
  MessageProjectionSchemaUnavailableError,
} from "./MessageProjectionMaintenanceErrors.js";
import {
  MessageProjectionAssessmentReader,
  type MessageProjectionAssessmentSnapshot,
} from "./MessageProjectionAssessmentReader.js";
import type { MessageProjectionMaintenancePlanner } from "./MessageProjectionMaintenancePlanner.js";
import { LockedFileMessageProjectionAppender } from "./LockedFileMessageProjectionAppender.js";
import type { RuntimeMessageMaterializer } from "./RuntimeMessageMaterializer.js";

export interface JournalConversationMessageProjectionServiceOptions {
  workspaceId: string;
  journal: ConversationJournalReader;
  messageFiles: ConversationMessageFileStore;
  projector: RuntimeMessageProjector;
  materializer: RuntimeMessageMaterializer;
  codec: MessageProjectionRecordCodec;
  planner?: MessageProjectionMaintenancePlanner;
  clock?: MessageProjectionClock;
  logger?: Logger;
  journalPageSize?: number;
  inspectionRetryCount?: number;
}

export class JournalConversationMessageProjectionService
  implements ConversationMessageProjectionService
{
  private readonly workspaceId: string;
  private readonly journal: ConversationJournalReader;
  private readonly messageFiles: ConversationMessageFileStore;
  private readonly projector: RuntimeMessageProjector;
  private readonly codec: MessageProjectionRecordCodec;
  private readonly clock: MessageProjectionClock;
  private readonly logger: Logger;
  private readonly assessmentReader: MessageProjectionAssessmentReader;
  private readonly pager: MessageProjectionJournalPager;

  constructor(options: JournalConversationMessageProjectionServiceOptions) {
    this.assertNonBlank("workspaceId", options.workspaceId);
    this.assertNonBlank("projector.id", options.projector.id);
    this.assertNonBlank("projector.version", options.projector.version);
    this.workspaceId = options.workspaceId;
    this.journal = options.journal;
    this.messageFiles = options.messageFiles;
    this.projector = options.projector;
    this.codec = options.codec;
    this.clock = options.clock ?? new SystemMessageProjectionClock();
    this.logger = (options.logger ?? noopLogger).child({
      component: "journal_conversation_message_projection_service",
      workspaceId: this.workspaceId,
      projectorId: this.projector.id,
      projectorVersion: this.projector.version,
    });
    const batchProjectorOptions: MessageProjectionBatchProjectorOptions = {
      workspaceId: this.workspaceId,
      projector: this.projector,
      materializer: options.materializer,
      codec: this.codec,
      clock: this.clock,
    };
    this.pager = new MessageProjectionJournalPager({
      journal: this.journal,
      batchProjector: new MessageProjectionBatchProjector(batchProjectorOptions),
      logger: this.logger,
      ...(options.journalPageSize !== undefined
        ? { pageSize: options.journalPageSize }
        : {}),
    });
    this.assessmentReader = new MessageProjectionAssessmentReader({
      journal: this.journal,
      projector: this.projector,
      ...(options.planner !== undefined ? { planner: options.planner } : {}),
      ...(options.inspectionRetryCount !== undefined
        ? { retryCount: options.inspectionRetryCount }
        : {}),
    });
  }

  async inspect(
    conversationId: string,
    options: MessageProjectionOperationOptions = {},
  ): Promise<MessageProjectionInspection> {
    this.assertConversationId(conversationId);
    throwIfMessageProjectionAborted(conversationId, options.signal);
    this.logger.debug("message_projection.inspect.started", { conversationId });
    const assessment = await this.assessmentReader.read(
      conversationId,
      (scanOptions) => this.messageFiles.scan(conversationId, scanOptions),
      options.signal,
    );
    this.logger.debug("message_projection.inspect.completed", {
      conversationId,
      health: assessment.inspection.health,
      recommendedAction: assessment.inspection.recommendedAction,
      journalHighWatermark: assessment.inspection.journalHighWatermark,
      projectedThroughSequence: assessment.inspection.projectedThroughSequence,
    });
    return assessment.inspection;
  }

  async synchronize(
    conversationId: string,
    options: MessageProjectionOperationOptions = {},
  ): Promise<MessageProjectionMaintenanceResult> {
    this.assertConversationId(conversationId);
    throwIfMessageProjectionAborted(conversationId, options.signal);
    this.logger.debug("message_projection.synchronize.started", { conversationId });

    const result = await this.messageFiles.withExclusive(conversationId, async (file) => {
      throwIfMessageProjectionAborted(conversationId, options.signal);
      const assessment = await this.assessmentReader.read(
        conversationId,
        (scanOptions) => file.scan(scanOptions),
        options.signal,
      );
      return this.applySynchronizationDecision(
        file,
        assessment,
        options.signal,
      );
    });

    this.logger.debug("message_projection.synchronize.completed", {
      conversationId,
      operations: [...result.operations],
      previousSequence: result.previousSequence,
      projectedThroughSequence: result.projectedThroughSequence,
      journalHighWatermark: result.journalHighWatermark,
      processedEventCount: result.processedEventCount,
      appendedMessageCount: result.appendedMessageCount,
    });
    return result;
  }

  async rebuild(
    conversationId: string,
    options: MessageProjectionOperationOptions = {},
  ): Promise<MessageProjectionMaintenanceResult> {
    this.assertConversationId(conversationId);
    throwIfMessageProjectionAborted(conversationId, options.signal);

    return this.messageFiles.withExclusive(conversationId, async (file) => {
      throwIfMessageProjectionAborted(conversationId, options.signal);
      const existing = await file.scan({ allowUnknownMessageTypes: true });
      const previousSequence = existing.state?.committedThroughSequence ?? 0;
      const targetSequence = await this.journal.getHighWatermark(conversationId);
      throwIfMessageProjectionAborted(conversationId, options.signal);
      return this.performRebuild(
        file,
        conversationId,
        previousSequence,
        targetSequence,
        "forced",
        options.signal,
      );
    });
  }

  private async applySynchronizationDecision(
    file: LockedConversationMessageFile,
    assessment: MessageProjectionAssessmentSnapshot,
    signal?: AbortSignal,
  ): Promise<MessageProjectionMaintenanceResult> {
    const { inspection, structuralScan } = assessment;
    const conversationId = inspection.conversationId;
    const previousSequence = inspection.projectedThroughSequence;
    const targetSequence = inspection.journalHighWatermark;
    const operations: MessageProjectionMaintenanceOperation[] = [];

    switch (inspection.recommendedAction) {
      case "none":
        return this.createResult({
          conversationId,
          operations,
          previousSequence,
          projectedThroughSequence: previousSequence,
          journalHighWatermark: targetSequence,
          processedEventCount: 0,
          appendedMessageCount: 0,
        });

      case "restore_schema":
        this.logger.warn("message_projection.schema.unavailable", { conversationId });
        throw new MessageProjectionSchemaUnavailableError(conversationId);

      case "rebuild": {
        const reason = inspection.rebuildReason;
        if (reason === undefined) {
          throw new MessageProjectionInvariantError(
            "Rebuild decision does not include a rebuild reason",
          );
        }
        this.logRebuildDecision(conversationId, reason);
        return this.performRebuild(
          file,
          conversationId,
          previousSequence,
          targetSequence,
          reason,
          signal,
        );
      }

      case "initialize": {
        const initial = this.createInitialRecords(conversationId);
        const initialized = await file.initialize(initial);
        const initializedState = this.requireState(initialized);
        operations.push("initialized");
        this.logger.info("message_projection.initialized", { conversationId });
        const range = await this.catchUp(
          file,
          initializedState,
          targetSequence,
          signal,
        );
        if (range.processedEventCount > 0) operations.push("caught_up");
        return this.createResult({
          conversationId,
          operations,
          previousSequence,
          projectedThroughSequence: range.state.committedThroughSequence,
          journalHighWatermark: targetSequence,
          processedEventCount: range.processedEventCount,
          appendedMessageCount: range.appendedMessageCount,
        });
      }

      case "truncate_and_catch_up": {
        const repaired = await file.truncateToCommitted(structuralScan);
        const repairedState = this.requireState(repaired);
        operations.push("tail_truncated");
        this.logger.info("message_projection.tail.repaired", {
          conversationId,
          projectedThroughSequence: repairedState.committedThroughSequence,
        });
        const range = await this.catchUp(
          file,
          repairedState,
          targetSequence,
          signal,
        );
        if (range.processedEventCount > 0) operations.push("caught_up");
        return this.createResult({
          conversationId,
          operations,
          previousSequence,
          projectedThroughSequence: range.state.committedThroughSequence,
          journalHighWatermark: targetSequence,
          processedEventCount: range.processedEventCount,
          appendedMessageCount: range.appendedMessageCount,
        });
      }

      case "catch_up": {
        const initialState = this.requireState(structuralScan);
        const range = await this.catchUp(file, initialState, targetSequence, signal);
        if (range.processedEventCount > 0) operations.push("caught_up");
        return this.createResult({
          conversationId,
          operations,
          previousSequence,
          projectedThroughSequence: range.state.committedThroughSequence,
          journalHighWatermark: targetSequence,
          processedEventCount: range.processedEventCount,
          appendedMessageCount: range.appendedMessageCount,
        });
      }
    }
  }

  private async catchUp(
    file: LockedConversationMessageFile,
    initialState: MessageProjectionSequenceState,
    targetSequence: number,
    signal?: AbortSignal,
  ): Promise<MessageProjectionRangeResult> {
    if (initialState.committedThroughSequence === targetSequence) {
      return {
        state: initialState,
        processedEventCount: 0,
        appendedMessageCount: 0,
      };
    }
    const appender = new LockedFileMessageProjectionAppender(file, initialState);
    const result = await this.pager.projectRange({
      conversationId: initialState.conversationId,
      fromSequence: initialState.committedThroughSequence,
      throughSequence: targetSequence,
      appender,
      mode: "catch_up",
      ...(signal !== undefined ? { signal } : {}),
    });
    this.logger.info("message_projection.catch_up.completed", {
      conversationId: initialState.conversationId,
      fromSequence: initialState.committedThroughSequence,
      projectedThroughSequence: result.state.committedThroughSequence,
      processedEventCount: result.processedEventCount,
      appendedMessageCount: result.appendedMessageCount,
    });
    return result;
  }

  private async performRebuild(
    file: LockedConversationMessageFile,
    conversationId: string,
    previousSequence: number,
    targetSequence: number,
    reason: MessageProjectionRebuildReason,
    signal?: AbortSignal,
  ): Promise<MessageProjectionMaintenanceResult> {
    throwIfMessageProjectionAborted(conversationId, signal);
    this.logger.info("message_projection.rebuild.started", {
      conversationId,
      reason,
      previousSequence,
      journalHighWatermark: targetSequence,
    });
    const initial = this.createInitialRecords(conversationId);
    let range: MessageProjectionRangeResult | undefined;
    const committed = await file.replaceAtomically(initial, async (replacement) => {
      range = await this.pager.projectRange({
        conversationId,
        fromSequence: 0,
        throughSequence: targetSequence,
        appender: replacement,
        mode: "rebuild",
        ...(signal !== undefined ? { signal } : {}),
      });
      throwIfMessageProjectionAborted(conversationId, signal);
    });
    const finalState = this.requireState(committed);
    const completedRange = range ?? {
      state: finalState,
      processedEventCount: 0,
      appendedMessageCount: 0,
    };
    this.logger.info("message_projection.rebuild.completed", {
      conversationId,
      reason,
      projectedThroughSequence: finalState.committedThroughSequence,
      processedEventCount: completedRange.processedEventCount,
      appendedMessageCount: completedRange.appendedMessageCount,
    });
    return this.createResult({
      conversationId,
      operations: ["rebuilt"],
      previousSequence,
      projectedThroughSequence: finalState.committedThroughSequence,
      journalHighWatermark: targetSequence,
      processedEventCount: completedRange.processedEventCount,
      appendedMessageCount: completedRange.appendedMessageCount,
      rebuildReason: reason,
    });
  }

  private createInitialRecords(
    conversationId: string,
  ): readonly [MessageProjectionHeaderRecord, MessageProjectionCheckpointRecord] {
    const createdAt = this.clock.now();
    const header = this.codec.createHeader({
      workspaceId: this.workspaceId,
      conversationId,
      projectorId: this.projector.id,
      projectorVersion: this.projector.version,
      createdAt,
    });
    const checkpoint = this.codec.createCheckpoint({
      workspaceId: this.workspaceId,
      conversationId,
      projectedThroughSequence: 0,
      messageCount: 0,
      committedAt: createdAt,
      previousHash: header.recordHash,
    });
    return [header, checkpoint];
  }

  private requireState(scan: MessageProjectionFileScan): MessageProjectionSequenceState {
    if (scan.status !== "valid" || scan.state === undefined) {
      throw new MessageProjectionInvariantError(
        `Message projection operation returned ${scan.status} without valid state`,
      );
    }
    return scan.state;
  }

  private createResult(
    input: Omit<MessageProjectionMaintenanceResult, "projectorId" | "projectorVersion">,
  ): MessageProjectionMaintenanceResult {
    return {
      ...input,
      projectorId: this.projector.id,
      projectorVersion: this.projector.version,
    };
  }

  private logRebuildDecision(
    conversationId: string,
    reason: Exclude<MessageProjectionRebuildReason, "forced">,
  ): void {
    if (reason === "corrupted") {
      this.logger.warn("message_projection.corruption.detected", { conversationId });
    } else if (reason === "journal_regressed") {
      this.logger.warn("message_projection.journal.regression_detected", {
        conversationId,
      });
    } else {
      this.logger.info("message_projection.projector.changed", { conversationId });
    }
  }

  private assertConversationId(conversationId: string): void {
    this.assertNonBlank("conversationId", conversationId);
  }

  private assertNonBlank(label: string, value: string): void {
    if (value.trim().length === 0) throw new TypeError(`${label} must not be blank`);
  }
}
