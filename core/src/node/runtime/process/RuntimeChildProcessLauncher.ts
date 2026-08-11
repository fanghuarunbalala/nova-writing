/** Launches one fixed Node child command without placing Runtime data in argv. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { noopLogger, type Logger } from "../../../observability/index.js";
import { RuntimeChildProcessLaunchError } from "./NodeConversationProcessErrors.js";

export const RUNTIME_CHILD_PROCESS_TERMINATION_SIGNAL = {
  terminate: "SIGTERM",
  kill: "SIGKILL",
} as const;

const DESKTOP_CHILD_LOG_ENV = "NOVEL_DESKTOP_CHILD_LOG" as const;

/**
 * stderr 内容捕获上限：正常运行的 child 不应写 stderr；仅当 child 异常退出时
 * （非零退出码或被信号杀死）才把缓冲的 stderr 原文写入日志用于崩溃诊断。
 * 健康运行（exit 0）永不泄漏 stderr 内容——保持 supervisor smoke 的脱敏不变量。
 * Capture cap for child stderr text. Healthy children write nothing to stderr;
 * buffered content is only logged when the child exits abnormally (non-zero exit
 * or signal), preserving the supervisor smoke's redaction invariant on clean runs.
 */
const STDERR_CAPTURE_LIMIT = 8 * 1024;

export type RuntimeChildProcessTerminationSignal =
  (typeof RUNTIME_CHILD_PROCESS_TERMINATION_SIGNAL)[keyof typeof RUNTIME_CHILD_PROCESS_TERMINATION_SIGNAL];

export type RuntimeChildProcessExitStatus =
  | Readonly<{
      kind: "exited";
      code: number | null;
      signal: string | null;
    }>
  | Readonly<{
      kind: "failed";
      errorName: string;
      errorCode?: string;
    }>;

export interface RuntimeChildProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;

  waitForExit(): Promise<RuntimeChildProcessExitStatus>;

  terminate(signal: RuntimeChildProcessTerminationSignal): boolean;
}

export interface RuntimeChildProcessLaunchRequest {
  readonly conversationId: string;
  readonly runtimeInstanceId: string;
}

export interface RuntimeChildProcessLauncher {
  launch(request: RuntimeChildProcessLaunchRequest): Promise<RuntimeChildProcess>;
}

export interface NodeRuntimeChildProcessLauncherOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly logger?: Logger;
}

export class NodeRuntimeChildProcessLauncher
  implements RuntimeChildProcessLauncher
{
  readonly #command: string;
  readonly #args: readonly string[];
  readonly #env: Readonly<Record<string, string>>;
  readonly #logger: Logger;

  constructor(options: NodeRuntimeChildProcessLauncherOptions) {
    this.#command = captureNonBlank(options.command, "Runtime child command");
    this.#args = Object.freeze(
      (options.args ?? []).map((argument, index) =>
        captureString(argument, `Runtime child argument ${index}`),
      ),
    );
    this.#env = Object.freeze({ ...(options.env ?? {}) });
    this.#logger = (options.logger ?? noopLogger).child({
      component: "runtime_child_process_launcher",
    });
  }

  async launch(
    request: RuntimeChildProcessLaunchRequest,
  ): Promise<RuntimeChildProcess> {
    const conversationId = captureNonBlank(
      request?.conversationId,
      "Conversation ID",
    );
    const runtimeInstanceId = captureNonBlank(
      request?.runtimeInstanceId,
      "Runtime instance ID",
    );
    this.#logger.info("runtime.process.launch_started", {
      conversationId,
      runtimeInstanceId,
      childLogConfigured:
        DESKTOP_CHILD_LOG_ENV in this.#env ||
        DESKTOP_CHILD_LOG_ENV in globalThis.process.env,
    });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.#command, [...this.#args], {
        detached: false,
        env: { ...globalThis.process.env, ...this.#env },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      const identity = captureErrorIdentity(error);
      this.#logger.error("runtime.process.launch_failed", {
        conversationId,
        runtimeInstanceId,
        ...identity,
      });
      throw new RuntimeChildProcessLaunchError(
        identity.errorName,
        identity.errorCode,
      );
    }

    const process = new SpawnedRuntimeChildProcess(
      child,
      conversationId,
      runtimeInstanceId,
      this.#logger,
    );
    try {
      await process.waitForStart();
      this.#logger.info("runtime.process.launch_completed", {
        conversationId,
        runtimeInstanceId,
      });
      return process;
    } catch (error) {
      const identity = captureErrorIdentity(error);
      this.#logger.error("runtime.process.launch_failed", {
        conversationId,
        runtimeInstanceId,
        ...identity,
      });
      throw new RuntimeChildProcessLaunchError(
        identity.errorName,
        identity.errorCode,
      );
    }
  }
}

class SpawnedRuntimeChildProcess implements RuntimeChildProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #conversationId: string;
  readonly #runtimeInstanceId: string;
  readonly #startPromise: Promise<void>;
  readonly #exitPromise: Promise<RuntimeChildProcessExitStatus>;
  readonly #logger: Logger;
  #resolveStart!: () => void;
  #rejectStart!: (error: RuntimeChildProcessLaunchError) => void;
  #resolveExit!: (exit: RuntimeChildProcessExitStatus) => void;
  #started = false;
  #settled = false;
  #stderrBytes = 0;
  #stderrLines = 0;
  #stderrText = "";
  #stderrTruncated = false;

  constructor(
    child: ChildProcessWithoutNullStreams,
    conversationId: string,
    runtimeInstanceId: string,
    logger: Logger,
  ) {
    this.#child = child;
    this.#conversationId = conversationId;
    this.#runtimeInstanceId = runtimeInstanceId;
    this.#logger = logger.child({ component: "spawned_runtime_child_process" });
    this.stdin = child.stdin;
    this.stdout = child.stdout;
    this.#startPromise = new Promise<void>((resolve, reject) => {
      this.#resolveStart = resolve;
      this.#rejectStart = reject;
    });
    this.#exitPromise = new Promise((resolve) => {
      this.#resolveExit = resolve;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.#stderrBytes += chunk.length;
      this.#stderrLines += chunk.toString("utf8").split("\n").length - 1;
      if (!this.#stderrTruncated) {
        const text = chunk.toString("utf8");
        const remaining = STDERR_CAPTURE_LIMIT - this.#stderrText.length;
        if (text.length > remaining) {
          this.#stderrText += text.slice(0, Math.max(0, remaining));
          this.#stderrTruncated = true;
        } else {
          this.#stderrText += text;
        }
      }
    });
    child.once("spawn", () => {
      this.#started = true;
      this.#resolveStart();
    });
    child.on("error", (error) => this.#handleError(error));
    child.once("exit", (code, signal) => {
      this.#logger.info("runtime.process.child_stderr_stats", {
        conversationId: this.#conversationId,
        runtimeInstanceId: this.#runtimeInstanceId,
        code,
        signal: signal ?? null,
        bytes: this.#stderrBytes,
        lines: this.#stderrLines,
      });
      // 崩溃诊断：仅当 child 异常退出（非零退出码或被信号杀死）时把 stderr 原文
      // 写入日志；健康运行（exit 0）不泄漏内容，保持 supervisor smoke 脱敏不变量。
      // Crash diagnosis: forward the stderr content only on abnormal exit. Healthy
      // runs (exit 0) never leak it, preserving the supervisor smoke's redaction.
      if (code !== 0 || signal !== null) {
        this.#logger.error("runtime.process.child_stderr", {
          conversationId: this.#conversationId,
          runtimeInstanceId: this.#runtimeInstanceId,
          code,
          signal: signal ?? null,
          ...(this.#stderrTruncated ? { truncated: true } : {}),
          text: this.#stderrText,
        });
      }
      this.#settleExit(Object.freeze({
        kind: "exited",
        code,
        signal: signal ?? null,
      }));
    });
  }

  waitForStart(): Promise<void> {
    return this.#startPromise;
  }

  stderrStats(): Readonly<{ bytes: number; lines: number }> {
    return Object.freeze({ bytes: this.#stderrBytes, lines: this.#stderrLines });
  }

  waitForExit(): Promise<RuntimeChildProcessExitStatus> {
    return this.#exitPromise;
  }

  terminate(signal: RuntimeChildProcessTerminationSignal): boolean {
    if (this.#settled) return false;
    try {
      return this.#child.kill(signal);
    } catch {
      return false;
    }
  }

  #handleError(error: unknown): void {
    const identity = captureErrorIdentity(error);
    const failure = new RuntimeChildProcessLaunchError(
      identity.errorName,
      identity.errorCode,
    );
    if (!this.#started) this.#rejectStart(failure);
    this.#settleExit(Object.freeze({
      kind: "failed",
      errorName: identity.errorName,
      ...(identity.errorCode !== undefined
        ? { errorCode: identity.errorCode }
        : {}),
    }));
  }

  #settleExit(exit: RuntimeChildProcessExitStatus): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#resolveExit(exit);
  }
}

function captureErrorIdentity(error: unknown): Readonly<{
  errorName: string;
  errorCode?: string;
}> {
  if (!(error instanceof Error)) {
    return Object.freeze({ errorName: "UnknownError" });
  }
  const errorName = captureSafeIdentity(error.name, "UnknownError");
  const candidate = (error as Error & { readonly code?: unknown }).code;
  const errorCode = typeof candidate === "string"
    ? captureSafeIdentity(candidate, undefined)
    : undefined;
  return Object.freeze({
    errorName,
    ...(errorCode !== undefined ? { errorCode } : {}),
  });
}

function captureSafeIdentity<T extends string | undefined>(
  value: unknown,
  fallback: T,
): string | T {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : fallback;
}

function captureNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be non-blank`);
  }
  return value;
}

function captureString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}
