/** Incremental byte-first JSONL decoder with pre-parse Runtime Frame limits. */
import {
  RUNTIME_IPC_MAX_FRAME_BYTES,
  captureRuntimeIpcFrame,
  type RuntimeIpcFrame,
} from "../../../runtime/ipc/index.js";
import {
  NODE_JSONL_IPC_FAILURE,
  NodeJsonlIpcError,
} from "./NodeJsonlIpcErrors.js";

export interface NodeJsonlFrameDecoderOptions {
  readonly maximumLineBytes?: number;
}

export class NodeJsonlFrameDecoder {
  readonly #maximumLineBytes: number;
  #pending = Buffer.alloc(0);

  constructor(options: NodeJsonlFrameDecoderOptions = {}) {
    this.#maximumLineBytes = captureMaximumLineBytes(
      options.maximumLineBytes ?? RUNTIME_IPC_MAX_FRAME_BYTES,
    );
  }

  push(chunkSource: Uint8Array | string): readonly RuntimeIpcFrame[] {
    const chunk = captureChunk(chunkSource);
    if (chunk.byteLength === 0) return Object.freeze([]);
    this.#pending = this.#pending.byteLength === 0
      ? chunk
      : Buffer.concat([this.#pending, chunk]);

    const frames: RuntimeIpcFrame[] = [];
    let lineStart = 0;
    for (let index = 0; index < this.#pending.byteLength; index += 1) {
      if (this.#pending[index] !== 0x0a) continue;
      let line = this.#pending.subarray(lineStart, index);
      if (line.at(-1) === 0x0d) line = line.subarray(0, line.byteLength - 1);
      frames.push(this.#decodeLine(line));
      lineStart = index + 1;
    }
    this.#pending = this.#pending.subarray(lineStart);
    if (this.#pending.byteLength > this.#maximumLineBytes) {
      throw new NodeJsonlIpcError(NODE_JSONL_IPC_FAILURE.lineOversized);
    }
    return Object.freeze(frames);
  }

  finish(): void {
    if (this.#pending.byteLength !== 0) {
      this.#pending = Buffer.alloc(0);
      throw new NodeJsonlIpcError(NODE_JSONL_IPC_FAILURE.incompleteLine);
    }
  }

  #decodeLine(line: Buffer): RuntimeIpcFrame {
    if (line.byteLength === 0) {
      throw new NodeJsonlIpcError(NODE_JSONL_IPC_FAILURE.invalidJson);
    }
    if (line.byteLength > this.#maximumLineBytes) {
      throw new NodeJsonlIpcError(NODE_JSONL_IPC_FAILURE.lineOversized);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.toString("utf8"));
    } catch {
      throw new NodeJsonlIpcError(NODE_JSONL_IPC_FAILURE.invalidJson);
    }
    try {
      return captureRuntimeIpcFrame(parsed);
    } catch {
      throw new NodeJsonlIpcError(NODE_JSONL_IPC_FAILURE.invalidFrame);
    }
  }
}

function captureChunk(value: Uint8Array | string): Buffer<ArrayBuffer> {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (!(value instanceof Uint8Array)) {
    throw new NodeJsonlIpcError(NODE_JSONL_IPC_FAILURE.invalidChunk);
  }
  return Buffer.from(value);
}

function captureMaximumLineBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Node JSONL IPC maximum line bytes must be positive");
  }
  return value;
}
