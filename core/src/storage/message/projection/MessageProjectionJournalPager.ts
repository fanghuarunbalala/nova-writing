/** Stable High-Watermark Journal pagination shared by catch-up and rebuild. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { ConversationJournalReader } from "../../journal/index.js";
import type {
  MessageProjectionReplacementWriter,
} from "../file/index.js";
import type { MessageProjectionSequenceState } from "../protocol/index.js";
import { throwIfMessageProjectionAborted } from "./MessageProjectionAbort.js";
import type { MessageProjectionBatchProjector } from "./MessageProjectionBatchProjector.js";
import {
  MessageProjectionInvariantError,
  MessageProjectionJournalGapError,
  MessageProjectionJournalWatermarkError,
} from "./MessageProjectionMaintenanceErrors.js";

export type MessageProjectionRangeMode = "catch_up" | "rebuild";

export interface ProjectMessageProjectionRangeInput {
  conversationId: string;
  fromSequence: number;
  throughSequence: number;
  appender: MessageProjectionReplacementWriter;
  mode: MessageProjectionRangeMode;
  signal?: AbortSignal;
}

export interface MessageProjectionRangeResult {
  state: MessageProjectionSequenceState;
  processedEventCount: number;
  appendedMessageCount: number;
}

export interface MessageProjectionJournalPagerOptions {
  journal: ConversationJournalReader;
  batchProjector: MessageProjectionBatchProjector;
  pageSize?: number;
  logger?: Logger;
}

export class MessageProjectionJournalPager {
  private readonly journal: ConversationJournalReader;
  private readonly batchProjector: MessageProjectionBatchProjector;
  private readonly pageSize: number;
  private readonly logger: Logger;

  constructor(options: MessageProjectionJournalPagerOptions) {
    this.journal = options.journal;
    this.batchProjector = options.batchProjector;
    this.pageSize = options.pageSize ?? 200;
    if (!Number.isSafeInteger(this.pageSize) || this.pageSize < 1 || this.pageSize > 1_000) {
      throw new TypeError("pageSize must be an integer between 1 and 1000");
    }
    this.logger = (options.logger ?? noopLogger).child({
      component: "message_projection_journal_pager",
    });
  }

  async projectRange(
    input: ProjectMessageProjectionRangeInput,
  ): Promise<MessageProjectionRangeResult> {
    this.assertRange(input);
    throwIfMessageProjectionAborted(input.conversationId, input.signal);

    let cursor = input.fromSequence;
    let processedEventCount = 0;
    let appendedMessageCount = 0;
    let state = input.appender.getState();
    this.assertAppenderState(input, state);

    while (cursor < input.throughSequence) {
      throwIfMessageProjectionAborted(input.conversationId, input.signal);
      this.logger.debug("message_projection.page.started", {
        conversationId: input.conversationId,
        mode: input.mode,
        fromSequence: cursor,
        throughSequence: input.throughSequence,
        pageSize: this.pageSize,
      });

      const page = await this.journal.list({
        conversationId: input.conversationId,
        anchor: { afterSequence: cursor },
        throughSequence: input.throughSequence,
        limit: this.pageSize,
      });
      throwIfMessageProjectionAborted(input.conversationId, input.signal);

      if (page.highWatermark !== input.throughSequence) {
        throw new MessageProjectionJournalWatermarkError(
          input.conversationId,
          input.throughSequence,
          page.highWatermark,
        );
      }
      if (page.events.length === 0) {
        throw new MessageProjectionJournalGapError(
          input.conversationId,
          cursor + 1,
          0,
        );
      }
      if (page.events.length > this.pageSize) {
        throw new MessageProjectionInvariantError(
          `Journal page exceeded configured page size ${this.pageSize}`,
        );
      }

      let expectedSequence = cursor + 1;
      for (const event of page.events) {
        if (event.conversationId !== input.conversationId) {
          throw new MessageProjectionInvariantError(
            `Journal Event ${event.id} belongs to a different Conversation`,
          );
        }
        if (event.sequence !== expectedSequence) {
          throw new MessageProjectionJournalGapError(
            input.conversationId,
            expectedSequence,
            event.sequence,
          );
        }
        if (event.sequence > input.throughSequence) {
          throw new MessageProjectionJournalWatermarkError(
            input.conversationId,
            input.throughSequence,
            event.sequence,
          );
        }
        expectedSequence += 1;
      }

      const lastEvent = page.events.at(-1);
      if (lastEvent === undefined) {
        throw new MessageProjectionInvariantError("Journal page has no final Event");
      }
      if (lastEvent.sequence < input.throughSequence && !page.hasNext) {
        throw new MessageProjectionJournalGapError(
          input.conversationId,
          lastEvent.sequence + 1,
          0,
        );
      }
      if (lastEvent.sequence === input.throughSequence && page.hasNext) {
        throw new MessageProjectionJournalWatermarkError(
          input.conversationId,
          input.throughSequence,
          input.throughSequence + 1,
        );
      }

      const batch = this.batchProjector.projectPage({
        conversationId: input.conversationId,
        events: page.events,
        initialState: state,
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      });
      throwIfMessageProjectionAborted(input.conversationId, input.signal);
      const previousState = state;
      state = await input.appender.appendCommittedBatch(batch.records);
      cursor = batch.projectedThroughSequence;
      this.assertCommittedPageState(previousState, state, cursor);
      processedEventCount += batch.processedEventCount;
      appendedMessageCount += batch.appendedMessageCount;

      this.logger.debug("message_projection.page.completed", {
        conversationId: input.conversationId,
        mode: input.mode,
        projectedThroughSequence: cursor,
        processedEventCount: batch.processedEventCount,
        appendedMessageCount: batch.appendedMessageCount,
      });
    }

    if (state.committedThroughSequence !== input.throughSequence) {
      throw new MessageProjectionInvariantError(
        `Projection stopped at Sequence ${state.committedThroughSequence} instead of ${input.throughSequence}`,
      );
    }
    throwIfMessageProjectionAborted(input.conversationId, input.signal);
    return { state, processedEventCount, appendedMessageCount };
  }

  private assertRange(input: ProjectMessageProjectionRangeInput): void {
    if (input.conversationId.trim().length === 0) {
      throw new MessageProjectionInvariantError("conversationId must not be blank");
    }
    if (
      !Number.isSafeInteger(input.fromSequence) ||
      input.fromSequence < 0 ||
      !Number.isSafeInteger(input.throughSequence) ||
      input.throughSequence < input.fromSequence
    ) {
      throw new MessageProjectionInvariantError("Invalid Message projection Journal range");
    }
  }

  private assertAppenderState(
    input: ProjectMessageProjectionRangeInput,
    state: MessageProjectionSequenceState,
  ): void {
    if (
      state.conversationId !== input.conversationId ||
      state.committedThroughSequence !== input.fromSequence ||
      !state.hasCommittedCheckpoint ||
      state.trailingRecordCount !== 0
    ) {
      throw new MessageProjectionInvariantError(
        "Message projection appender state does not match the requested Journal range",
      );
    }
  }

  private assertCommittedPageState(
    previous: MessageProjectionSequenceState,
    current: MessageProjectionSequenceState,
    projectedThroughSequence: number,
  ): void {
    if (
      current.workspaceId !== previous.workspaceId ||
      current.conversationId !== previous.conversationId ||
      current.projectorId !== previous.projectorId ||
      current.projectorVersion !== previous.projectorVersion ||
      current.committedThroughSequence !== projectedThroughSequence ||
      !current.hasCommittedCheckpoint ||
      current.trailingRecordCount !== 0
    ) {
      throw new MessageProjectionInvariantError(
        "Message projection appender returned an invalid committed page state",
      );
    }
  }
}
