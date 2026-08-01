/** Internal fixed-capacity FIFO used by one live Event Subscription. */
export type AsyncEventQueueState = "open" | "closed" | "failed";

export type AsyncEventQueueEnqueueResult =
  | "delivered"
  | "buffered"
  | "full"
  | "closed";

interface PendingAsyncEventQueueRead<T> {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
}

export class BoundedAsyncEventQueue<T> {
  readonly capacity: number;

  private readonly buffer: Array<T | undefined>;
  private head = 0;
  private bufferedCount = 0;
  private queueState: AsyncEventQueueState = "open";
  private failure?: Error;
  private pendingRead?: PendingAsyncEventQueueRead<T>;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new TypeError("Async Event Queue capacity must be a positive safe integer");
    }
    this.capacity = capacity;
    this.buffer = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.bufferedCount;
  }

  get state(): AsyncEventQueueState {
    return this.queueState;
  }

  enqueue(value: T): AsyncEventQueueEnqueueResult {
    if (this.queueState !== "open") return "closed";
    const pendingRead = this.pendingRead;
    if (pendingRead !== undefined) {
      this.pendingRead = undefined;
      pendingRead.resolve({ done: false, value });
      return "delivered";
    }
    if (this.bufferedCount >= this.capacity) return "full";

    const tail = (this.head + this.bufferedCount) % this.capacity;
    this.buffer[tail] = value;
    this.bufferedCount += 1;
    return "buffered";
  }

  next(): Promise<IteratorResult<T>> {
    if (this.bufferedCount > 0) {
      const value = this.buffer[this.head] as T;
      this.buffer[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.bufferedCount -= 1;
      return Promise.resolve({ done: false, value });
    }
    if (this.queueState === "failed") {
      return Promise.reject(this.failure);
    }
    if (this.queueState === "closed") {
      return Promise.resolve({ done: true, value: undefined });
    }
    if (this.pendingRead !== undefined) {
      return Promise.reject(new Error("Async Event Queue already has a pending read"));
    }

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.pendingRead = { resolve, reject };
    });
  }

  close(): void {
    if (this.queueState !== "open") return;
    this.queueState = "closed";
    this.clearBuffer();
    const pendingRead = this.pendingRead;
    this.pendingRead = undefined;
    pendingRead?.resolve({ done: true, value: undefined });
  }

  fail(error: Error): void {
    if (this.queueState !== "open") return;
    this.queueState = "failed";
    this.failure = error;
    this.clearBuffer();
    const pendingRead = this.pendingRead;
    this.pendingRead = undefined;
    pendingRead?.reject(error);
  }

  private clearBuffer(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.bufferedCount = 0;
  }
}
