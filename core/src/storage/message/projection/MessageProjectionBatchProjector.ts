/** Projects one contiguous Journal page into Message records plus one Checkpoint. */
import type { RuntimeMessageProjector } from "../../../runtime/index.js";
import type { PersistedConversationEventSnapshot } from "../../journal/index.js";
import type {
  MessageProjectionFileRecord,
  MessageProjectionRecordCodec,
  MessageProjectionSequenceState,
} from "../protocol/index.js";
import { throwIfMessageProjectionAborted } from "./MessageProjectionAbort.js";
import type { MessageProjectionClock } from "./MessageProjectionClock.js";
import {
  MessageProjectionEventProjectionError,
  MessageProjectionInvariantError,
  MessageProjectionMaintenanceAbortedError,
} from "./MessageProjectionMaintenanceErrors.js";
import type { RuntimeMessageMaterializer } from "./RuntimeMessageMaterializer.js";

export interface MessageProjectionBatch {
  records: readonly MessageProjectionFileRecord[];
  projectedThroughSequence: number;
  processedEventCount: number;
  appendedMessageCount: number;
}

export interface ProjectMessageProjectionBatchInput {
  conversationId: string;
  events: readonly PersistedConversationEventSnapshot[];
  initialState: MessageProjectionSequenceState;
  signal?: AbortSignal;
}

export interface MessageProjectionBatchProjectorOptions {
  workspaceId: string;
  projector: RuntimeMessageProjector;
  materializer: RuntimeMessageMaterializer;
  codec: MessageProjectionRecordCodec;
  clock: MessageProjectionClock;
}

export class MessageProjectionBatchProjector {
  private readonly workspaceId: string;
  private readonly projector: RuntimeMessageProjector;
  private readonly materializer: RuntimeMessageMaterializer;
  private readonly codec: MessageProjectionRecordCodec;
  private readonly clock: MessageProjectionClock;

  constructor(options: MessageProjectionBatchProjectorOptions) {
    this.assertNonBlank("workspaceId", options.workspaceId);
    this.assertNonBlank("projector.id", options.projector.id);
    this.assertNonBlank("projector.version", options.projector.version);
    this.workspaceId = options.workspaceId;
    this.projector = options.projector;
    this.materializer = options.materializer;
    this.codec = options.codec;
    this.clock = options.clock;
  }

  projectPage(input: ProjectMessageProjectionBatchInput): MessageProjectionBatch {
    if (input.events.length === 0) {
      throw new MessageProjectionInvariantError("Cannot project an empty Journal page");
    }
    this.assertState(input.conversationId, input.initialState);

    const records: MessageProjectionFileRecord[] = [];
    let previousHash = input.initialState.lastRecordHash;
    let messageCount = input.initialState.messageCount;
    let appendedMessageCount = 0;

    for (const event of input.events) {
      throwIfMessageProjectionAborted(input.conversationId, input.signal);
      if (event.conversationId !== input.conversationId) {
        throw new MessageProjectionInvariantError(
          `Journal Event ${event.id} belongs to a different Conversation`,
        );
      }

      try {
        const drafts = this.projector.project(event);
        const materialized = this.materializer.materialize(
          event,
          {
            projectorId: this.projector.id,
            projectorVersion: this.projector.version,
          },
          drafts,
        );
        for (const item of materialized) {
          messageCount += 1;
          const record = this.codec.createMessage({
            workspaceId: this.workspaceId,
            conversationId: input.conversationId,
            messageIndex: messageCount,
            source: {
              sequence: event.sequence,
              eventId: event.id,
              eventType: event.eventType,
              direction: event.direction,
              ordinal: item.ordinal,
            },
            message: item.snapshot,
            previousHash,
          });
          records.push(record);
          previousHash = record.recordHash;
          appendedMessageCount += 1;
        }
      } catch (error) {
        if (error instanceof MessageProjectionMaintenanceAbortedError) throw error;
        throw new MessageProjectionEventProjectionError(
          input.conversationId,
          event.id,
          event.sequence,
          this.projector.id,
          this.projector.version,
          { cause: error },
        );
      }
    }

    throwIfMessageProjectionAborted(input.conversationId, input.signal);
    const lastEvent = input.events.at(-1);
    if (lastEvent === undefined) {
      throw new MessageProjectionInvariantError("Projected Journal page has no final Event");
    }
    try {
      const checkpoint = this.codec.createCheckpoint({
        workspaceId: this.workspaceId,
        conversationId: input.conversationId,
        projectedThroughSequence: lastEvent.sequence,
        messageCount,
        committedAt: this.clock.now(),
        previousHash,
      });
      records.push(checkpoint);
    } catch (error) {
      throw new MessageProjectionInvariantError(
        "Failed to create Message projection Checkpoint",
        { cause: error },
      );
    }

    return {
      records,
      projectedThroughSequence: lastEvent.sequence,
      processedEventCount: input.events.length,
      appendedMessageCount,
    };
  }

  private assertState(
    conversationId: string,
    state: MessageProjectionSequenceState,
  ): void {
    if (
      state.workspaceId !== this.workspaceId ||
      state.conversationId !== conversationId ||
      state.projectorId !== this.projector.id ||
      state.projectorVersion !== this.projector.version ||
      !state.hasCommittedCheckpoint ||
      state.trailingRecordCount !== 0
    ) {
      throw new MessageProjectionInvariantError(
        "Message projection append state does not match the active Projector",
      );
    }
  }

  private assertNonBlank(label: string, value: string): void {
    if (value.trim().length === 0) {
      throw new TypeError(`${label} must not be blank`);
    }
  }
}
