/** Converts raw Node process exits into the existing safe Runtime exit union. */
import {
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  type ConversationRuntimeExit,
  type ConversationRuntimeShutdownReason,
} from "../../../conversation/host/index.js";
import type { RuntimeChildProcessExitStatus } from "./RuntimeChildProcessLauncher.js";

export interface RuntimeProcessExitClock {
  now(): string;
}

export interface RuntimeProcessExitNormalizerOptions {
  readonly clock?: RuntimeProcessExitClock;
}

export class RuntimeProcessExitNormalizer {
  readonly #clock: RuntimeProcessExitClock;

  constructor(options: RuntimeProcessExitNormalizerOptions = {}) {
    this.#clock = options.clock ?? SYSTEM_RUNTIME_PROCESS_EXIT_CLOCK;
  }

  normalize(
    status: RuntimeChildProcessExitStatus,
    shutdownReason?: ConversationRuntimeShutdownReason,
  ): ConversationRuntimeExit {
    const exitedAt = this.#readTimestamp();
    if (status.kind === "exited" && shutdownReason !== undefined) {
      return Object.freeze({
        kind: "stopped",
        exitedAt,
        reason: captureShutdownReason(shutdownReason),
      });
    }
    if (status.kind === "failed") {
      const errorName = captureIdentity(status.errorName, "RuntimeChildProcessError");
      const errorCode = status.errorCode === undefined
        ? undefined
        : captureIdentity(status.errorCode, undefined);
      return Object.freeze({
        kind: "crashed",
        exitedAt,
        errorName,
        ...(errorCode !== undefined ? { errorCode } : {}),
      });
    }
    return Object.freeze({
      kind: "crashed",
      exitedAt,
      errorName: "RuntimeChildProcessExitError",
      errorCode: status.code === 0
        ? "RUNTIME_CHILD_PROCESS_UNEXPECTED_EXIT"
        : status.code === null
          ? "RUNTIME_CHILD_PROCESS_SIGNAL_EXIT"
          : "RUNTIME_CHILD_PROCESS_NON_ZERO_EXIT",
    });
  }

  #readTimestamp(): string {
    try {
      const timestamp = this.#clock.now();
      if (!Number.isNaN(Date.parse(timestamp))) return timestamp;
    } catch {}
    return new Date().toISOString();
  }
}

const SYSTEM_RUNTIME_PROCESS_EXIT_CLOCK: RuntimeProcessExitClock = Object.freeze({
  now: () => new Date().toISOString(),
});

function captureShutdownReason(
  value: ConversationRuntimeShutdownReason,
): ConversationRuntimeShutdownReason {
  if (!Object.values(CONVERSATION_RUNTIME_SHUTDOWN_REASON).includes(value)) {
    throw new TypeError("Conversation Runtime shutdown reason is invalid");
  }
  return value;
}

function captureIdentity<T extends string | undefined>(
  value: unknown,
  fallback: T,
): string | T {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : fallback;
}
