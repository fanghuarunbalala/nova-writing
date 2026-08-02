/** Deterministic in-memory duplex connection for Runtime IPC channel validation. */
import {
  captureRuntimeIpcFrame,
  type RuntimeIpcFrame,
} from "../protocol/index.js";
import type { RuntimeIpcConnection } from "./RuntimeIpcConnection.js";
import {
  RuntimeIpcConnectionBackpressureError,
  RuntimeIpcConnectionClosedError,
} from "./RuntimeIpcPeerErrors.js";

export interface InMemoryRuntimeIpcConnectionPairOptions {
  readonly receiveCapacity?: number;
}

export interface InMemoryRuntimeIpcConnectionPair {
  readonly first: RuntimeIpcConnection;
  readonly second: RuntimeIpcConnection;
}

interface PendingRead {
  readonly resolve: (result: IteratorResult<RuntimeIpcFrame>) => void;
}

class InMemoryFrameQueue {
  readonly #buffer: RuntimeIpcFrame[] = [];
  #pending?: PendingRead;
  #closed = false;

  constructor(readonly capacity: number) {}

  enqueue(frame: RuntimeIpcFrame): void {
    if (this.#closed) throw new RuntimeIpcConnectionClosedError();
    const pending = this.#pending;
    if (pending) {
      this.#pending = undefined;
      pending.resolve({ done: false, value: frame });
      return;
    }
    if (this.#buffer.length >= this.capacity) {
      throw new RuntimeIpcConnectionBackpressureError(this.capacity);
    }
    this.#buffer.push(frame);
  }

  next(): Promise<IteratorResult<RuntimeIpcFrame>> {
    const frame = this.#buffer.shift();
    if (frame) return Promise.resolve({ done: false, value: frame });
    if (this.#closed) return Promise.resolve({ done: true, value: undefined });
    if (this.#pending) {
      return Promise.reject(new TypeError("Runtime IPC connection already has a pending read"));
    }
    return new Promise((resolve) => {
      this.#pending = { resolve };
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#buffer.length === 0) {
      const pending = this.#pending;
      this.#pending = undefined;
      pending?.resolve({ done: true, value: undefined });
    }
  }
}

class InMemoryRuntimeIpcConnection implements RuntimeIpcConnection {
  #closed = false;
  #remote?: InMemoryFrameQueue;

  constructor(
    private readonly incoming: InMemoryFrameQueue,
    private readonly closePair: () => void,
  ) {}

  connect(remote: InMemoryFrameQueue): void {
    this.#remote = remote;
  }

  async send(frameSource: RuntimeIpcFrame): Promise<void> {
    if (this.#closed || !this.#remote) throw new RuntimeIpcConnectionClosedError();
    this.#remote.enqueue(captureRuntimeIpcFrame(frameSource));
  }

  next(): Promise<IteratorResult<RuntimeIpcFrame>> {
    return this.incoming.next();
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.closePair();
  }

  markClosed(): void {
    this.#closed = true;
  }
}

export function createInMemoryRuntimeIpcConnectionPair(
  options: InMemoryRuntimeIpcConnectionPairOptions = {},
): InMemoryRuntimeIpcConnectionPair {
  const capacity = captureCapacity(options.receiveCapacity ?? 1024);
  const firstQueue = new InMemoryFrameQueue(capacity);
  const secondQueue = new InMemoryFrameQueue(capacity);
  let first!: InMemoryRuntimeIpcConnection;
  let second!: InMemoryRuntimeIpcConnection;
  let closed = false;
  const closePair = (): void => {
    if (closed) return;
    closed = true;
    first.markClosed();
    second.markClosed();
    firstQueue.close();
    secondQueue.close();
  };
  first = new InMemoryRuntimeIpcConnection(firstQueue, closePair);
  second = new InMemoryRuntimeIpcConnection(secondQueue, closePair);
  first.connect(secondQueue);
  second.connect(firstQueue);
  return Object.freeze({ first, second });
}

function captureCapacity(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Runtime IPC receive capacity must be positive");
  }
  return value;
}
