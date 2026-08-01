/**
 * Splits an asynchronously-read file into LF-terminated byte lines while
 * preserving exact offsets needed for durable tail truncation.
 */
import type { FileHandle } from "node:fs/promises";

export interface JsonlBufferLine {
  bytes: Buffer;
  startOffset: number;
  endOffset: number;
  terminated: boolean;
}

export interface JsonlBufferLineScannerOptions {
  maxLineByteLength?: number;
}

export class JsonlLineTooLargeError extends Error {
  constructor(public readonly maxLineByteLength: number) {
    super(`JSONL line exceeds ${maxLineByteLength} bytes`);
    this.name = "JsonlLineTooLargeError";
  }
}

export class JsonlBufferLineScanner {
  private readonly maxLineByteLength: number;

  constructor(options: JsonlBufferLineScannerOptions = {}) {
    this.maxLineByteLength = options.maxLineByteLength ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxLineByteLength) || this.maxLineByteLength < 1) {
      throw new TypeError("maxLineByteLength must be a positive safe integer");
    }
  }

  async *scan(handle: FileHandle): AsyncIterable<JsonlBufferLine> {
    let pending = Buffer.alloc(0);
    let pendingStartOffset = 0;
    let streamOffset = 0;

    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunkValue of stream) {
      const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
      const chunkStartOffset = streamOffset;
      streamOffset += chunk.byteLength;

      const combined =
        pending.byteLength === 0 ? chunk : Buffer.concat([pending, chunk]);
      const combinedStartOffset =
        pending.byteLength === 0 ? chunkStartOffset : pendingStartOffset;
      let lineStart = 0;

      while (true) {
        const newlineIndex = combined.indexOf(0x0a, lineStart);
        if (newlineIndex === -1) break;
        const lineLength = newlineIndex - lineStart;
        this.assertLineLength(lineLength);
        yield {
          bytes: combined.subarray(lineStart, newlineIndex),
          startOffset: combinedStartOffset + lineStart,
          endOffset: combinedStartOffset + newlineIndex + 1,
          terminated: true,
        };
        lineStart = newlineIndex + 1;
      }

      pending = combined.subarray(lineStart);
      pendingStartOffset = combinedStartOffset + lineStart;
      this.assertLineLength(pending.byteLength);
    }

    if (pending.byteLength > 0) {
      yield {
        bytes: pending,
        startOffset: pendingStartOffset,
        endOffset: pendingStartOffset + pending.byteLength,
        terminated: false,
      };
    }
  }

  private assertLineLength(lineLength: number): void {
    if (lineLength > this.maxLineByteLength) {
      throw new JsonlLineTooLargeError(this.maxLineByteLength);
    }
  }
}
