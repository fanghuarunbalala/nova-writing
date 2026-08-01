/**
 * Node JSONL adapter for committed Runtime Message projections.
 *
 * @example
 * ```ts
 * await store.withExclusive(conversationId, async (file) => {
 *   const scan = await file.scan();
 *   if (scan.status === "repairable_tail") {
 *     await file.truncateToCommitted(scan);
 *   }
 * });
 * ```
 */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  MessageProjectionRecordSequenceValidator,
  type ConversationMessageFilePage,
  type ConversationMessageFileQuery,
  type ConversationMessageFileStore,
  type LockedConversationMessageFile,
  type MessageProjectionCheckpointRecord,
  type MessageProjectionFileRecord,
  type MessageProjectionFileScan,
  type MessageProjectionHeaderRecord,
  type MessageProjectionRecordCodec,
  type ScanConversationMessageFileOptions,
} from "../../storage/index.js";
import { AtomicMessageFileWriter } from "./AtomicMessageFileWriter.js";
import {
  ConversationMessageFileLock,
  type ConversationMessageFileLockOptions,
} from "./ConversationMessageFileLock.js";
import {
  ConversationMessagePathResolver,
  type ConversationMessagePaths,
} from "./ConversationMessagePathResolver.js";
import { JsonlMessageFileScanner } from "./JsonlMessageFileScanner.js";
import type { JsonlMessageFileScanResult } from "./JsonlMessageFileScanner.js";
import { KeyedAsyncMutex } from "./KeyedAsyncMutex.js";
import {
  MessageFileStoreClosedError,
  MessageProjectionFileAlreadyExistsError,
  MessageProjectionFileMissingError,
  MessageProjectionFileOperationError,
  MessageProjectionFileStaleScanError,
  MessageProjectionFileStateError,
} from "./MessageFileStoreErrors.js";

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 1_000;

export interface JsonlConversationMessageStoreOptions {
  workspaceId: string;
  storeDir: string;
  codec: MessageProjectionRecordCodec;
  logger?: Logger;
  maxLineByteLength?: number;
  lock?: Omit<ConversationMessageFileLockOptions, "logger">;
}

export class JsonlConversationMessageStore implements ConversationMessageFileStore {
  private readonly workspaceId: string;
  private readonly codec: MessageProjectionRecordCodec;
  private readonly logger: Logger;
  private readonly pathResolver: ConversationMessagePathResolver;
  private readonly scanner: JsonlMessageFileScanner;
  private readonly writer = new AtomicMessageFileWriter();
  private readonly mutex = new KeyedAsyncMutex();
  private readonly fileLock: ConversationMessageFileLock;
  private readonly activeOperations = new Set<Promise<unknown>>();
  private closed = false;

  constructor(options: JsonlConversationMessageStoreOptions) {
    if (options.workspaceId.trim().length === 0) {
      throw new TypeError("workspaceId must not be blank");
    }
    this.workspaceId = options.workspaceId;
    this.codec = options.codec;
    this.logger = (options.logger ?? noopLogger).child({
      component: "jsonl_conversation_message_store",
      workspaceId: this.workspaceId,
    });
    this.pathResolver = new ConversationMessagePathResolver({ storeDir: options.storeDir });
    this.scanner = new JsonlMessageFileScanner({
      workspaceId: this.workspaceId,
      codec: this.codec,
      logger: this.logger,
      ...(options.maxLineByteLength !== undefined
        ? { maxLineByteLength: options.maxLineByteLength }
        : {}),
    });
    this.fileLock = new ConversationMessageFileLock({
      logger: this.logger,
      ...options.lock,
    });
  }

  async scan(
    conversationId: string,
    options: ScanConversationMessageFileOptions = {},
  ): Promise<MessageProjectionFileScan> {
    this.assertOpen();
    const paths = this.pathResolver.resolve(conversationId);
    return this.scanner.scan(conversationId, paths.messageFilePath, options);
  }

  async list(query: ConversationMessageFileQuery): Promise<ConversationMessageFilePage> {
    this.assertOpen();
    const afterMessageIndex = this.parseNonNegativeInteger(
      "afterMessageIndex",
      query.afterMessageIndex ?? 0,
    );
    const limit = this.parseLimit(query.limit ?? DEFAULT_PAGE_LIMIT);
    const paths = this.pathResolver.resolve(query.conversationId);
    const scan = await this.scanner.scan(query.conversationId, paths.messageFilePath, {
      ...(query.allowUnknownMessageTypes === true
        ? { allowUnknownMessageTypes: true }
        : {}),
    });
    this.assertReadable(scan);

    const state = scan.state;
    if (state === undefined) {
      throw new MessageProjectionFileStateError(
        query.conversationId,
        scan.status,
        "Valid Message projection Scan does not contain sequence state",
      );
    }
    const highWatermarkMessageIndex = this.parseNonNegativeInteger(
      "highWatermarkMessageIndex",
      query.highWatermarkMessageIndex ?? state.committedMessageCount,
    );
    if (highWatermarkMessageIndex > state.committedMessageCount) {
      throw new MessageProjectionFileOperationError(
        `highWatermarkMessageIndex cannot exceed ${state.committedMessageCount}`,
      );
    }

    const matching = scan.committedMessages.filter(
      (record) =>
        record.messageIndex > afterMessageIndex &&
        record.messageIndex <= highWatermarkMessageIndex,
    );
    const items = matching.slice(0, limit);
    const hasMore = matching.length > items.length;
    const last = items.at(-1);
    return {
      conversationId: query.conversationId,
      items,
      highWatermarkMessageIndex,
      projectedThroughSequence: state.committedThroughSequence,
      hasMore,
      ...(hasMore && last !== undefined
        ? { nextAfterMessageIndex: last.messageIndex }
        : {}),
    };
  }

  async withExclusive<T>(
    conversationId: string,
    operation: (file: LockedConversationMessageFile) => Promise<T>,
  ): Promise<T> {
    this.assertOpen();
    const paths = this.pathResolver.resolve(conversationId);
    const pending = this.mutex.withExclusive(paths.conversationKey, () =>
      this.fileLock.withExclusive(
        conversationId,
        paths.conversationDir,
        paths.lockFilePath,
        async () => {
          const file = new LockedJsonlConversationMessageFile({
            workspaceId: this.workspaceId,
            conversationId,
            paths,
            codec: this.codec,
            scanner: this.scanner,
            writer: this.writer,
            logger: this.logger,
          });
          try {
            return await operation(file);
          } finally {
            file.deactivate();
          }
        },
      ),
    );
    this.activeOperations.add(pending);
    try {
      return await pending;
    } finally {
      this.activeOperations.delete(pending);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([...this.activeOperations]);
  }

  private assertReadable(scan: MessageProjectionFileScan): void {
    if (scan.status === "missing") {
      throw new MessageProjectionFileMissingError(scan.conversationId);
    }
    if (scan.status !== "valid") {
      throw new MessageProjectionFileStateError(
        scan.conversationId,
        scan.status,
        `Message projection file is not readable: ${scan.status}`,
      );
    }
  }

  private parseLimit(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_LIMIT) {
      throw new MessageProjectionFileOperationError(
        `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`,
      );
    }
    return value;
  }

  private parseNonNegativeInteger(label: string, value: number): number {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new MessageProjectionFileOperationError(
        `${label} must be a non-negative safe integer`,
      );
    }
    return value;
  }

  private assertOpen(): void {
    if (this.closed) throw new MessageFileStoreClosedError();
  }
}

interface LockedJsonlConversationMessageFileOptions {
  workspaceId: string;
  conversationId: string;
  paths: ConversationMessagePaths;
  codec: MessageProjectionRecordCodec;
  scanner: JsonlMessageFileScanner;
  writer: AtomicMessageFileWriter;
  logger: Logger;
}

class LockedJsonlConversationMessageFile implements LockedConversationMessageFile {
  readonly conversationId: string;

  private readonly workspaceId: string;
  private readonly paths: ConversationMessagePaths;
  private readonly codec: MessageProjectionRecordCodec;
  private readonly scanner: JsonlMessageFileScanner;
  private readonly writer: AtomicMessageFileWriter;
  private readonly logger: Logger;
  private active = true;

  constructor(options: LockedJsonlConversationMessageFileOptions) {
    this.workspaceId = options.workspaceId;
    this.conversationId = options.conversationId;
    this.paths = options.paths;
    this.codec = options.codec;
    this.scanner = options.scanner;
    this.writer = options.writer;
    this.logger = options.logger;
  }

  deactivate(): void {
    this.active = false;
  }

  async scan(
    options: ScanConversationMessageFileOptions = {},
  ): Promise<MessageProjectionFileScan> {
    this.assertActive();
    return this.scanner.scan(this.conversationId, this.paths.messageFilePath, options);
  }

  async initialize(
    records: readonly [MessageProjectionHeaderRecord, MessageProjectionCheckpointRecord],
  ): Promise<MessageProjectionFileScan> {
    this.assertActive();
    this.logger.debug("message_projection.file.initialize_started", {
      conversationId: this.conversationId,
    });
    if (await this.writer.exists(this.paths.messageFilePath)) {
      throw new MessageProjectionFileAlreadyExistsError(this.conversationId);
    }
    this.validateCompleteFile(records, true);
    await this.writer.initialize(this.paths.messageFilePath, this.encodeLines(records));
    const scan = await this.requireValidScan();
    this.logger.info("message_projection.file.created", {
      conversationId: this.conversationId,
      committedRecordCount: scan.committedRecordCount,
    });
    return scan;
  }

  async appendCommittedBatch(
    records: readonly MessageProjectionFileRecord[],
  ): Promise<MessageProjectionFileScan> {
    this.assertActive();
    this.logger.debug("message_projection.file.append_started", {
      conversationId: this.conversationId,
      recordCount: records.length,
    });
    if (records.length === 0 || records.at(-1)?.recordType !== "checkpoint") {
      throw new MessageProjectionFileOperationError(
        "Committed append batch must be non-empty and end with a Checkpoint",
      );
    }
    if (records.some((record) => record.recordType === "header")) {
      throw new MessageProjectionFileOperationError(
        "Committed append batch cannot contain a Header",
      );
    }

    const current = await this.scanner.scan(
      this.conversationId,
      this.paths.messageFilePath,
    );
    this.assertValid(current);
    this.validateCompleteFile([...current.records, ...records], false);
    await this.writer.append(this.paths.messageFilePath, this.encodeLines(records));
    this.logger.debug("message_projection.file.append_synced", {
      conversationId: this.conversationId,
      recordCount: records.length,
    });
    return this.requireValidScan();
  }

  async truncateToCommitted(scan: MessageProjectionFileScan): Promise<MessageProjectionFileScan> {
    this.assertActive();
    this.logger.debug("message_projection.file.truncate_started", {
      conversationId: this.conversationId,
      trailingByteLength: scan.trailingByteLength,
      trailingRecordCount: scan.trailingRecordCount,
    });
    if (scan.conversationId !== this.conversationId) {
      throw new MessageProjectionFileStaleScanError(this.conversationId);
    }
    if (scan.status === "valid") return scan;
    if (scan.status !== "repairable_tail") {
      throw new MessageProjectionFileStateError(
        this.conversationId,
        scan.status,
        "Only a repairable Message projection tail can be truncated",
      );
    }

    const current = await this.scanner.scan(
      this.conversationId,
      this.paths.messageFilePath,
      { allowUnknownMessageTypes: true },
    );
    if (!this.sameScanBoundary(scan, current)) {
      throw new MessageProjectionFileStaleScanError(this.conversationId);
    }

    await this.writer.truncate(this.paths.messageFilePath, current.committedByteLength);
    const repaired = await this.requireValidScan({ allowUnknownMessageTypes: true });
    this.logger.info("message_projection.trailing_records_truncated", {
      conversationId: this.conversationId,
      truncatedByteLength: current.trailingByteLength,
      truncatedRecordCount: current.trailingRecordCount,
    });
    return repaired;
  }

  async replace(records: readonly MessageProjectionFileRecord[]): Promise<MessageProjectionFileScan> {
    this.assertActive();
    this.logger.debug("message_projection.file.replace_started", {
      conversationId: this.conversationId,
      recordCount: records.length,
    });
    this.validateCompleteFile(records, false);
    await this.writer.replace(this.paths.messageFilePath, this.encodeLines(records));
    const scan = await this.requireValidScan();
    this.logger.debug("message_projection.file.replace_completed", {
      conversationId: this.conversationId,
      committedRecordCount: scan.committedRecordCount,
    });
    return scan;
  }

  private validateCompleteFile(
    records: readonly MessageProjectionFileRecord[],
    requireInitialCheckpoint: boolean,
  ): void {
    if (records.length < 2 || records[0]?.recordType !== "header") {
      throw new MessageProjectionFileOperationError(
        "Message projection file must begin with a Header and contain a Checkpoint",
      );
    }
    if (records.at(-1)?.recordType !== "checkpoint") {
      throw new MessageProjectionFileOperationError(
        "Complete Message projection file must end with a Checkpoint",
      );
    }
    if (requireInitialCheckpoint && records.length !== 2) {
      throw new MessageProjectionFileOperationError(
        "Message projection initialization requires exactly Header and Checkpoint zero",
      );
    }

    for (const record of records) this.codec.encode(record);
    const validator = new MessageProjectionRecordSequenceValidator({
      expectedWorkspaceId: this.workspaceId,
      expectedConversationId: this.conversationId,
    });
    const state = validator.acceptAll(records);
    if (!state.hasCommittedCheckpoint || state.trailingRecordCount !== 0) {
      throw new MessageProjectionFileOperationError(
        "Message projection records do not form a fully committed file",
      );
    }
  }

  private encodeLines(records: readonly MessageProjectionFileRecord[]): string {
    return `${records.map((record) => this.codec.encode(record)).join("\n")}\n`;
  }

  private async requireValidScan(
    options: ScanConversationMessageFileOptions = {},
  ): Promise<JsonlMessageFileScanResult> {
    const scan = await this.scanner.scan(
      this.conversationId,
      this.paths.messageFilePath,
      options,
    );
    this.assertValid(scan);
    return scan;
  }

  private assertValid(scan: MessageProjectionFileScan): void {
    if (scan.status === "missing") {
      throw new MessageProjectionFileMissingError(this.conversationId);
    }
    if (scan.status !== "valid") {
      throw new MessageProjectionFileStateError(
        this.conversationId,
        scan.status,
        `Message projection file is not valid after operation: ${scan.status}`,
      );
    }
  }

  private sameScanBoundary(
    expected: MessageProjectionFileScan,
    actual: MessageProjectionFileScan,
  ): boolean {
    return (
      actual.status === "repairable_tail" &&
      expected.totalByteLength === actual.totalByteLength &&
      expected.committedByteLength === actual.committedByteLength &&
      expected.fileSnapshot?.size === actual.fileSnapshot?.size &&
      expected.fileSnapshot?.modifiedAtMs === actual.fileSnapshot?.modifiedAtMs &&
      expected.state?.committedRecordHash === actual.state?.committedRecordHash
    );
  }

  private assertActive(): void {
    if (!this.active) {
      throw new MessageProjectionFileOperationError(
        "Locked Conversation Message file handle is no longer active",
      );
    }
  }
}
