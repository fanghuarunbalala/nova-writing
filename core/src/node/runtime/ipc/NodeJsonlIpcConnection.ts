/** Node stream Runtime IPC connection using bounded JSONL decoding and writes. */
import type { Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  RUNTIME_IPC_MAX_FRAME_BYTES,
  RuntimeIpcConnectionClosedError,
  captureRuntimeIpcFrame,
  type RuntimeIpcConnection,
  type RuntimeIpcFrame,
} from "../../../runtime/ipc/index.js";
import { NodeJsonlFrameDecoder } from "./NodeJsonlFrameDecoder.js";
import {
  NODE_JSONL_IPC_FAILURE,
  NodeJsonlIpcError,
} from "./NodeJsonlIpcErrors.js";

export interface NodeJsonlIpcConnectionOptions {
  readonly readable: Readable;
  readonly writable: Writable;
  readonly maximumLineBytes?: number;
  readonly receiveCapacity?: number;
  readonly logger?: Logger;
}

interface PendingRead {
  readonly resolve: (result: IteratorResult<RuntimeIpcFrame>) => void;
  readonly reject: (error: unknown) => void;
}

interface PendingWriteSpace {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

class AsyncFrameBuffer {
  readonly #frames: RuntimeIpcFrame[] = [];
  readonly #waitingForSpace: PendingWriteSpace[] = [];
  #pendingRead?: PendingRead;
  #closed = false;
  #failure?: Error;

  constructor(readonly capacity: number) {}

  async enqueue(frame: RuntimeIpcFrame): Promise<void> {
    while (!this.#closed && !this.#failure && this.#frames.length >= this.capacity) {
      await new Promise<void>((resolve, reject) => {
        this.#waitingForSpace.push({ resolve, reject });
      });
    }
    if (this.#failure) throw this.#failure;
    if (this.#closed) throw new RuntimeIpcConnectionClosedError();
    const pendingRead = this.#pendingRead;
    if (pendingRead) {
      this.#pendingRead = undefined;
      pendingRead.resolve({ done: false, value: frame });
      return;
    }
    this.#frames.push(frame);
  }

  next(): Promise<IteratorResult<RuntimeIpcFrame>> {
    const frame = this.#frames.shift();
    if (frame) {
      this.#waitingForSpace.shift()?.resolve();
      return Promise.resolve({ done: false, value: frame });
    }
    if (this.#failure) return Promise.reject(this.#failure);
    if (this.#closed) return Promise.resolve({ done: true, value: undefined });
    if (this.#pendingRead) {
      return Promise.reject(new TypeError("Node JSONL IPC already has a pending read"));
    }
    return new Promise((resolve, reject) => {
      this.#pendingRead = { resolve, reject };
    });
  }

  close(): void {
    if (this.#closed || this.#failure) return;
    this.#closed = true;
    const pendingRead = this.#pendingRead;
    this.#pendingRead = undefined;
    if (this.#frames.length === 0) {
      pendingRead?.resolve({ done: true, value: undefined });
    }
    for (const pending of this.#waitingForSpace.splice(0)) {
      pending.reject(new RuntimeIpcConnectionClosedError());
    }
  }

  fail(error: Error): void {
    if (this.#closed || this.#failure) return;
    this.#failure = error;
    this.#frames.length = 0;
    const pendingRead = this.#pendingRead;
    this.#pendingRead = undefined;
    pendingRead?.reject(error);
    for (const pending of this.#waitingForSpace.splice(0)) pending.reject(error);
  }
}

export class NodeJsonlIpcConnection implements RuntimeIpcConnection {
  readonly #readable: Readable;
  readonly #writable: Writable;
  readonly #maximumLineBytes: number;
  readonly #frames: AsyncFrameBuffer;
  readonly #logger: Logger;
  #writeTail: Promise<void> = Promise.resolve();
  #closed = false;
  #closePromise?: Promise<void>;

  constructor(options: NodeJsonlIpcConnectionOptions) {
    this.#readable = options.readable;
    this.#writable = options.writable;
    this.#maximumLineBytes = capturePositiveInteger(
      options.maximumLineBytes ?? RUNTIME_IPC_MAX_FRAME_BYTES,
      "Node JSONL IPC maximum line bytes",
    );
    this.#frames = new AsyncFrameBuffer(capturePositiveInteger(
      options.receiveCapacity ?? 1024,
      "Node JSONL IPC receive capacity",
    ));
    this.#logger = (options.logger ?? noopLogger).child({
      component: "node_jsonl_ipc_connection",
    });
    this.#readable.on("error", (error) => {
      this.#logger.info("runtime.ipc.readable_error_event", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    });
    void this.#readLoop();
  }

  send(frameSource: RuntimeIpcFrame): Promise<void> {
    if (this.#closed) return Promise.reject(new RuntimeIpcConnectionClosedError());
    const frame = captureRuntimeIpcFrame(frameSource);
    const line = `${JSON.stringify(frame)}\n`;
    if (Buffer.byteLength(line, "utf8") - 1 > this.#maximumLineBytes) {
      return Promise.reject(
        new NodeJsonlIpcError(NODE_JSONL_IPC_FAILURE.lineOversized),
      );
    }
    const write = this.#writeTail.then(() => this.#writeLine(line));
    this.#writeTail = write.catch(() => undefined);
    return write;
  }

  next(): Promise<IteratorResult<RuntimeIpcFrame>> {
    return this.#frames.next();
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  close(): Promise<void> {
    this.#closePromise ??= this.#closeOnce();
    return this.#closePromise;
  }

  async #readLoop(): Promise<void> {
    const decoder = new NodeJsonlFrameDecoder({
      maximumLineBytes: this.#maximumLineBytes,
    });
    try {
      for await (const chunk of this.#readable) {
        for (const frame of decoder.push(captureReadableChunk(chunk))) {
          await this.#frames.enqueue(frame);
          this.#logger.debug("runtime.ipc.frame_received", frameLogIdentity(frame));
        }
      }
      decoder.finish();
      this.#frames.close();
      this.#logger.info("runtime.ipc.readable_closed");
    } catch (error) {
      if (this.#closed) return;
      const normalized = normalizeStreamError(error);
      this.#frames.fail(normalized);
      this.#logger.warn("runtime.ipc.readable_failed", {
        errorName: normalized.name,
        errorCode: normalized.code,
      });
    }
  }

  async #writeLine(line: string): Promise<void> {
    if (this.#closed) throw new RuntimeIpcConnectionClosedError();
    try {
      const accepted = this.#writable.write(line, "utf8");
      if (!accepted) await waitForWritableDrain(this.#writable);
    } catch {
      throw new NodeJsonlIpcError(NODE_JSONL_IPC_FAILURE.streamFailed);
    }
  }

  async #closeOnce(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#frames.close();
    try {
      await this.#writeTail;
      if (!this.#writable.destroyed && !this.#writable.writableEnded) {
        this.#writable.end();
        await finished(this.#writable, { readable: false }).catch(() => undefined);
      }
    } finally {
      if (!this.#readable.destroyed) this.#readable.destroy();
      this.#logger.info("runtime.ipc.connection_closed");
    }
  }
}

function captureReadableChunk(value: unknown): Uint8Array | string {
  if (typeof value === "string" || value instanceof Uint8Array) return value;
  throw new NodeJsonlIpcError(NODE_JSONL_IPC_FAILURE.invalidChunk);
}

function capturePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be positive`);
  }
  return value;
}

function normalizeStreamError(error: unknown): NodeJsonlIpcError {
  return error instanceof NodeJsonlIpcError
    ? error
    : new NodeJsonlIpcError(NODE_JSONL_IPC_FAILURE.streamFailed);
}

function waitForWritableDrain(writable: Writable): Promise<void> {
  if (writable.destroyed || writable.writableEnded) {
    return Promise.reject(
      new NodeJsonlIpcError(NODE_JSONL_IPC_FAILURE.streamFailed),
    );
  }
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      writable.off("drain", handleDrain);
      writable.off("error", handleFailure);
      writable.off("close", handleFailure);
    };
    const handleDrain = () => {
      cleanup();
      resolve();
    };
    const handleFailure = () => {
      cleanup();
      reject(new NodeJsonlIpcError(NODE_JSONL_IPC_FAILURE.streamFailed));
    };
    writable.once("drain", handleDrain);
    writable.once("error", handleFailure);
    writable.once("close", handleFailure);
  });
}

function frameLogIdentity(frame: RuntimeIpcFrame) {
  return {
    frameType: frame.frameType,
    ...(frame.frameType === "request" || frame.frameType === "response"
      ? { requestId: frame.requestId }
      : {}),
    ...(frame.frameType === "notification"
      ? { notificationId: frame.notificationId, method: frame.method }
      : {}),
  };
}
