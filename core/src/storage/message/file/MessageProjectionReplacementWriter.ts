/**
 * Streaming writer used inside one atomic Message projection replacement.
 * Callers append only fully committed batches and derive the next record chain
 * from the returned immutable sequence state.
 */
import type {
  MessageProjectionFileRecord,
  MessageProjectionSequenceState,
} from "../protocol/index.js";

export interface MessageProjectionReplacementWriter {
  readonly conversationId: string;

  getState(): MessageProjectionSequenceState;

  appendCommittedBatch(
    records: readonly MessageProjectionFileRecord[],
  ): Promise<MessageProjectionSequenceState>;
}
