/**
 * Performs chunked, canonical JSONL validation and separates committed state
 * from a recoverable uncommitted tail.
 */
import { open } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  MessageProjectionRecordSequenceValidator,
  type MessageProjectionFileErrorSummary,
  type MessageProjectionFileRecord,
  type MessageProjectionFileScan,
  type MessageProjectionHeaderRecord,
  type MessageProjectionMessageRecord,
  type MessageProjectionRecordCodec,
  type ScanConversationMessageFileOptions,
} from "../../storage/index.js";
import { MessageProjectionFileChangedDuringScanError } from "./MessageFileStoreErrors.js";
import { JsonlBufferLineScanner } from "./JsonlBufferLineScanner.js";

export interface JsonlMessageFileScanResult extends MessageProjectionFileScan {
  committedMessages: readonly MessageProjectionMessageRecord[];
  records: readonly MessageProjectionFileRecord[];
}

export interface JsonlMessageFileScannerOptions {
  workspaceId: string;
  codec: MessageProjectionRecordCodec;
  logger?: Logger;
  maxLineByteLength?: number;
  changeRetryCount?: number;
}

export class JsonlMessageFileScanner {
  private readonly workspaceId: string;
  private readonly codec: MessageProjectionRecordCodec;
  private readonly logger: Logger;
  private readonly lineScanner: JsonlBufferLineScanner;
  private readonly changeRetryCount: number;

  constructor(options: JsonlMessageFileScannerOptions) {
    if (options.workspaceId.trim().length === 0) {
      throw new TypeError("workspaceId must not be blank");
    }
    this.workspaceId = options.workspaceId;
    this.codec = options.codec;
    this.logger = (options.logger ?? noopLogger).child({
      component: "jsonl_message_file_scanner",
      workspaceId: this.workspaceId,
    });
    this.lineScanner = new JsonlBufferLineScanner({
      ...(options.maxLineByteLength !== undefined
        ? { maxLineByteLength: options.maxLineByteLength }
        : {}),
    });
    this.changeRetryCount = options.changeRetryCount ?? 2;
  }

  async scan(
    conversationId: string,
    filePath: string,
    options: ScanConversationMessageFileOptions = {},
  ): Promise<JsonlMessageFileScanResult> {
    this.logger.debug("message_projection.file.scan_started", { conversationId });

    for (let attempt = 0; attempt <= this.changeRetryCount; attempt += 1) {
      const result = await this.scanOnce(conversationId, filePath, options);
      if (result !== "changed") {
        this.logger.debug("message_projection.file.scan_completed", {
          conversationId,
          status: result.status,
          totalByteLength: result.totalByteLength,
          committedByteLength: result.committedByteLength,
          completeRecordCount: result.completeRecordCount,
          committedRecordCount: result.committedRecordCount,
          trailingRecordCount: result.trailingRecordCount,
        });
        return result;
      }
    }

    throw new MessageProjectionFileChangedDuringScanError(conversationId);
  }

  private async scanOnce(
    conversationId: string,
    filePath: string,
    options: ScanConversationMessageFileOptions,
  ): Promise<JsonlMessageFileScanResult | "changed"> {
    let handle;
    try {
      handle = await open(filePath, "r");
    } catch (error) {
      if (this.isNodeError(error, "ENOENT")) return this.missing(conversationId);
      throw error;
    }

    try {
      const before = await handle.stat();
      const validator = new MessageProjectionRecordSequenceValidator({
        expectedWorkspaceId: this.workspaceId,
        expectedConversationId: conversationId,
      });
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const committedMessages: MessageProjectionMessageRecord[] = [];
      const records: MessageProjectionFileRecord[] = [];
      let pendingMessages: MessageProjectionMessageRecord[] = [];
      let header: MessageProjectionHeaderRecord | undefined;
      let completeRecordCount = 0;
      let committedByteLength = 0;
      let committedRecordCount = 0;
      let hasCommittedCheckpoint = false;
      let scanError: unknown;

      try {
        for await (const line of this.lineScanner.scan(handle)) {
          if (!line.terminated) {
            throw new Error("Message projection file ends with an unterminated JSONL line");
          }
          if (line.bytes.byteLength === 0) {
            throw new Error("Message projection file contains a blank JSONL line");
          }
          if (line.bytes.at(-1) === 0x0d) {
            throw new Error("Message projection file must use LF rather than CRLF");
          }

          const record = this.codec.decode(decoder.decode(line.bytes), {
            ...(options.allowUnknownMessageTypes === true
              ? { allowUnknownMessageTypes: true }
              : {}),
          });
          validator.accept(record);
          records.push(record);
          completeRecordCount += 1;

          if (record.recordType === "header") header = record;
          if (record.recordType === "message") pendingMessages.push(record);
          if (record.recordType === "checkpoint") {
            hasCommittedCheckpoint = true;
            committedByteLength = line.endOffset;
            committedRecordCount = completeRecordCount;
            committedMessages.push(...pendingMessages);
            pendingMessages = [];
          }
        }
      } catch (error) {
        scanError = error;
      }

      const after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) return "changed";

      let state;
      try {
        state = completeRecordCount === 0 ? undefined : validator.getState();
      } catch (error) {
        scanError ??= error;
      }

      const totalByteLength = after.size;
      const trailingByteLength = totalByteLength - committedByteLength;
      const status = hasCommittedCheckpoint
        ? trailingByteLength === 0 && scanError === undefined
          ? "valid"
          : "repairable_tail"
        : "corrupted";

      return {
        conversationId,
        status,
        totalByteLength,
        committedByteLength,
        trailingByteLength,
        completeRecordCount,
        committedRecordCount,
        trailingRecordCount: Math.max(0, completeRecordCount - committedRecordCount),
        ...(header !== undefined ? { header } : {}),
        ...(state !== undefined ? { state } : {}),
        ...(scanError !== undefined ? { error: this.toErrorSummary(scanError) } : {}),
        fileSnapshot: {
          size: after.size,
          modifiedAtMs: after.mtimeMs,
        },
        committedMessages,
        records,
      };
    } finally {
      await handle.close();
    }
  }

  private missing(conversationId: string): JsonlMessageFileScanResult {
    return {
      conversationId,
      status: "missing",
      totalByteLength: 0,
      committedByteLength: 0,
      trailingByteLength: 0,
      completeRecordCount: 0,
      committedRecordCount: 0,
      trailingRecordCount: 0,
      committedMessages: [],
      records: [],
    };
  }

  private toErrorSummary(error: unknown): MessageProjectionFileErrorSummary {
    if (!(error instanceof Error)) {
      return { name: "Error", message: "Unknown Message projection Scan failure" };
    }
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return {
      name: error.name,
      ...(code !== undefined ? { code } : {}),
      message: error.message,
    };
  }

  private isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === code;
  }
}
