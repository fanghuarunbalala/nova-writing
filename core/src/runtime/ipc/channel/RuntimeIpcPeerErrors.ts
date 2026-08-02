/** Stable Runtime IPC channel failures without Frame payloads or raw causes. */
export type RuntimeIpcQueueLane = "control" | "data";

export class RuntimeIpcPeerStateError extends Error {
  readonly code = "RUNTIME_IPC_PEER_STATE_INVALID";

  constructor(readonly state: "created" | "running" | "closing" | "closed") {
    super(`Runtime IPC Peer cannot perform this operation while ${state}`);
    this.name = "RuntimeIpcPeerStateError";
  }
}

export class RuntimeIpcPeerClosedError extends Error {
  readonly code = "RUNTIME_IPC_PEER_CLOSED";
  readonly retryable = true;

  constructor() {
    super("Runtime IPC Peer is closed");
    this.name = "RuntimeIpcPeerClosedError";
  }
}

export class RuntimeIpcBackpressureError extends Error {
  readonly code = "RUNTIME_IPC_BACKPRESSURE";
  readonly retryable = true;

  constructor(
    readonly lane: RuntimeIpcQueueLane,
    readonly capacity: number,
  ) {
    super(`Runtime IPC ${lane} queue is full`);
    this.name = "RuntimeIpcBackpressureError";
  }
}

export class RuntimeIpcRequestCancelledError extends Error {
  readonly code = "RUNTIME_IPC_REQUEST_CANCELLED";
  readonly retryable = false;

  constructor(readonly requestId: string) {
    super(`Runtime IPC request was cancelled: ${requestId}`);
    this.name = "RuntimeIpcRequestCancelledError";
  }
}

export class RuntimeIpcSessionMismatchError extends Error {
  readonly code = "RUNTIME_IPC_SESSION_MISMATCH";

  constructor(readonly expectedSessionId: string) {
    super("Runtime IPC Frame does not belong to the active Session");
    this.name = "RuntimeIpcSessionMismatchError";
  }
}

export class RuntimeIpcConnectionClosedError extends Error {
  readonly code = "RUNTIME_IPC_CONNECTION_CLOSED";
  readonly retryable = true;

  constructor() {
    super("Runtime IPC connection is closed");
    this.name = "RuntimeIpcConnectionClosedError";
  }
}

export class RuntimeIpcConnectionBackpressureError extends Error {
  readonly code = "RUNTIME_IPC_CONNECTION_BACKPRESSURE";
  readonly retryable = true;

  constructor(readonly capacity: number) {
    super("Runtime IPC connection receive queue is full");
    this.name = "RuntimeIpcConnectionBackpressureError";
  }
}
