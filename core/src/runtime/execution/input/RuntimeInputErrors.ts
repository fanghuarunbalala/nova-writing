/** Stable Runtime input queue errors without Event payload or raw content. */
export class RuntimeInputQueueFullError extends Error {
  readonly code = "RUNTIME_INPUT_QUEUE_FULL";

  constructor(
    public readonly lane: "control" | "turn",
    public readonly capacity: number,
  ) {
    super(`Runtime ${lane} input queue is full`);
    this.name = "RuntimeInputQueueFullError";
  }
}

export class RuntimeInputConflictError extends Error {
  readonly code = "RUNTIME_INPUT_CONFLICT";

  constructor(
    public readonly conversationId: string,
    public readonly sequence: number,
  ) {
    super("Runtime input conflicts with an already queued Event");
    this.name = "RuntimeInputConflictError";
  }
}

export class RuntimeInputRejectedError extends Error {
  readonly code = "RUNTIME_INPUT_REJECTED";

  constructor(public readonly reason: "invalid_event" | "conversation_mismatch") {
    super(`Runtime input was rejected: ${reason}`);
    this.name = "RuntimeInputRejectedError";
  }
}
