/** Protocol-aware streaming writer for one staging Message projection file. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  MessageProjectionRecordSequenceValidator,
  type MessageProjectionCheckpointRecord,
  type MessageProjectionFileRecord,
  type MessageProjectionHeaderRecord,
  type MessageProjectionRecordCodec,
  type MessageProjectionReplacementWriter,
  type MessageProjectionSequenceState,
} from "../../storage/index.js";
import type { AtomicMessageFileReplacement } from "./AtomicMessageFileReplacement.js";
import {
  MessageProjectionReplacementConcurrentWriteError,
  MessageProjectionReplacementInactiveError,
  MessageProjectionReplacementValidationError,
} from "./MessageFileStoreErrors.js";

type ReplacementWriterState = "active" | "finalized" | "committed" | "aborted";

export interface JsonlMessageProjectionReplacementWriterOptions {
  workspaceId: string;
  conversationId: string;
  initialRecords: readonly [
    MessageProjectionHeaderRecord,
    MessageProjectionCheckpointRecord,
  ];
  codec: MessageProjectionRecordCodec;
  replacement: AtomicMessageFileReplacement;
  logger?: Logger;
}

export class JsonlMessageProjectionReplacementWriter
  implements MessageProjectionReplacementWriter
{
  readonly conversationId: string;
  readonly stagingPath: string;

  private readonly codec: MessageProjectionRecordCodec;
  private readonly replacement: AtomicMessageFileReplacement;
  private readonly validator: MessageProjectionRecordSequenceValidator;
  private readonly logger: Logger;
  private state: ReplacementWriterState = "active";
  private inFlight: Promise<void> | undefined;
  private failure: unknown;

  private constructor(options: JsonlMessageProjectionReplacementWriterOptions) {
    this.conversationId = options.conversationId;
    this.stagingPath = options.replacement.stagingPath;
    this.codec = options.codec;
    this.replacement = options.replacement;
    this.validator = new MessageProjectionRecordSequenceValidator({
      expectedWorkspaceId: options.workspaceId,
      expectedConversationId: options.conversationId,
    });
    this.logger = (options.logger ?? noopLogger).child({
      component: "jsonl_message_projection_replacement_writer",
      conversationId: this.conversationId,
    });
  }

  static async create(
    options: JsonlMessageProjectionReplacementWriterOptions,
  ): Promise<JsonlMessageProjectionReplacementWriter> {
    const writer = new JsonlMessageProjectionReplacementWriter(options);
    try {
      const content = writer.validateAndEncodeInitial(options.initialRecords);
      await options.replacement.append(content);
      return writer;
    } catch (error) {
      await options.replacement.abort();
      throw error;
    }
  }

  getState(): MessageProjectionSequenceState {
    this.assertActive();
    if (this.inFlight !== undefined) {
      throw new MessageProjectionReplacementConcurrentWriteError(this.conversationId);
    }
    this.throwFailure();
    return { ...this.validator.getState() };
  }

  async appendCommittedBatch(
    records: readonly MessageProjectionFileRecord[],
  ): Promise<MessageProjectionSequenceState> {
    this.assertActive();
    if (this.inFlight !== undefined) {
      const error = new MessageProjectionReplacementConcurrentWriteError(this.conversationId);
      this.failure ??= error;
      throw error;
    }
    this.throwFailure();

    this.logger.debug("message_projection.replacement.batch_started", {
      recordCount: records.length,
    });
    const operation = this.appendValidatedBatch(records);
    this.inFlight = operation;
    try {
      await operation;
      this.throwFailure();
      const state = this.validator.getState();
      this.logger.debug("message_projection.replacement.batch_completed", {
        recordCount: records.length,
        committedRecordCount: state.committedRecordCount,
        committedMessageCount: state.committedMessageCount,
        committedThroughSequence: state.committedThroughSequence,
      });
      return { ...state };
    } catch (error) {
      this.failure ??= error;
      throw error;
    } finally {
      this.inFlight = undefined;
    }
  }

  async finalize(): Promise<MessageProjectionSequenceState> {
    this.assertActive();
    await this.waitForInFlight();
    this.throwFailure();
    const state = this.validator.getState();
    if (!state.hasCommittedCheckpoint || state.trailingRecordCount !== 0) {
      throw new MessageProjectionReplacementValidationError(
        "Replacement staging file must end at a committed Checkpoint",
      );
    }
    await this.replacement.syncAndClose();
    this.state = "finalized";
    return { ...state };
  }

  async commit(): Promise<void> {
    if (this.state !== "finalized") {
      throw new MessageProjectionReplacementInactiveError(this.conversationId);
    }
    await this.replacement.commit();
    this.state = "committed";
  }

  async abort(): Promise<void> {
    if (this.state === "committed" || this.state === "aborted") return;
    await this.waitForInFlight();
    await this.replacement.abort();
    this.state = "aborted";
  }

  private validateAndEncodeInitial(
    records: readonly [MessageProjectionHeaderRecord, MessageProjectionCheckpointRecord],
  ): string {
    if (records[0].recordType !== "header" || records[1].recordType !== "checkpoint") {
      throw new MessageProjectionReplacementValidationError(
        "Replacement must begin with Header and Checkpoint zero",
      );
    }
    const encoded = records.map((record) => this.codec.encode(record));
    const state = this.validator.acceptAll(records);
    if (
      !state.hasCommittedCheckpoint ||
      state.committedThroughSequence !== 0 ||
      state.committedMessageCount !== 0 ||
      state.trailingRecordCount !== 0
    ) {
      throw new MessageProjectionReplacementValidationError(
        "Replacement initial records must commit sequence zero with zero Messages",
      );
    }
    return `${encoded.join("\n")}\n`;
  }

  private async appendValidatedBatch(
    records: readonly MessageProjectionFileRecord[],
  ): Promise<void> {
    if (records.length === 0 || records.at(-1)?.recordType !== "checkpoint") {
      throw new MessageProjectionReplacementValidationError(
        "Replacement batch must be non-empty and end with a Checkpoint",
      );
    }
    if (records.some((record) => record.recordType === "header")) {
      throw new MessageProjectionReplacementValidationError(
        "Replacement batch cannot contain a Header",
      );
    }

    const encoded = records.map((record) => this.codec.encode(record));
    const state = this.validator.acceptAll(records);
    if (!state.hasCommittedCheckpoint || state.trailingRecordCount !== 0) {
      throw new MessageProjectionReplacementValidationError(
        "Replacement batch does not end at a committed Checkpoint",
      );
    }
    await this.replacement.append(`${encoded.join("\n")}\n`);
  }

  private async waitForInFlight(): Promise<void> {
    if (this.inFlight === undefined) return;
    await this.inFlight.catch(() => undefined);
  }

  private throwFailure(): void {
    if (this.failure === undefined) return;
    if (this.failure instanceof Error) throw this.failure;
    throw new MessageProjectionReplacementValidationError(
      "Message projection replacement failed",
      { cause: this.failure },
    );
  }

  private assertActive(): void {
    if (this.state !== "active") {
      throw new MessageProjectionReplacementInactiveError(this.conversationId);
    }
  }
}
