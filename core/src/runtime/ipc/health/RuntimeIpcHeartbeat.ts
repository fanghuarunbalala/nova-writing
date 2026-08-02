/** Session heartbeat protocol and timer-driven emitter/monitor. */
import type { JsonValue } from "../../../event/index.js";
import type { RuntimeIpcNotificationHandler } from "../channel/index.js";

export const RUNTIME_IPC_HEARTBEAT_METHOD = "runtime.heartbeat" as const;
export const RUNTIME_IPC_HEARTBEAT_INTERVAL_MS = 2_000;
export const RUNTIME_IPC_HEARTBEAT_MISSED_LIMIT = 3;

export interface RuntimeIpcHeartbeatPayload {
  readonly sequence: number;
  readonly sentAt: string;
}

export interface RuntimeIpcHeartbeatSender {
  notify(method: string, payload: JsonValue, options?: { readonly lane?: "control" | "data" }): Promise<void>;
}

export interface RuntimeIpcHeartbeatTimer {
  now(): number;
  every(intervalMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

export type RuntimeIpcHealthState = "healthy" | "unhealthy" | "stopped";

export class RuntimeIpcHeartbeatEmitter {
  readonly #sender: RuntimeIpcHeartbeatSender;
  readonly #timer: RuntimeIpcHeartbeatTimer;
  readonly #intervalMs: number;
  #sequence = 0;
  #handle?: unknown;

  constructor(sender: RuntimeIpcHeartbeatSender, timer = SYSTEM_TIMER, intervalMs = RUNTIME_IPC_HEARTBEAT_INTERVAL_MS) {
    this.#sender = sender;
    this.#timer = timer;
    this.#intervalMs = positiveInteger(intervalMs);
  }

  start(): void {
    if (this.#handle !== undefined) return;
    this.#send();
    this.#handle = this.#timer.every(this.#intervalMs, () => this.#send());
  }

  stop(): void {
    if (this.#handle === undefined) return;
    this.#timer.cancel(this.#handle);
    this.#handle = undefined;
  }

  #send(): void {
    this.#sequence += 1;
    void this.#sender.notify(RUNTIME_IPC_HEARTBEAT_METHOD, {
      sequence: this.#sequence,
      sentAt: new Date(this.#timer.now()).toISOString(),
    }, { lane: "control" }).catch(() => undefined);
  }
}

export class RuntimeIpcHeartbeatMonitor implements RuntimeIpcNotificationHandler {
  readonly #timer: RuntimeIpcHeartbeatTimer;
  readonly #intervalMs: number;
  readonly #missedLimit: number;
  readonly #unhealthy: Promise<void>;
  #resolveUnhealthy!: () => void;
  #lastObservedAt: number;
  #lastSequence = 0;
  #handle?: unknown;
  #settled = false;
  #state: RuntimeIpcHealthState = "healthy";

  constructor(timer = SYSTEM_TIMER, intervalMs = RUNTIME_IPC_HEARTBEAT_INTERVAL_MS, missedLimit = RUNTIME_IPC_HEARTBEAT_MISSED_LIMIT) {
    this.#timer = timer;
    this.#intervalMs = positiveInteger(intervalMs);
    this.#missedLimit = positiveInteger(missedLimit);
    this.#lastObservedAt = timer.now();
    this.#unhealthy = new Promise((resolve) => { this.#resolveUnhealthy = resolve; });
  }

  start(): void {
    if (this.#handle !== undefined || this.#settled) return;
    this.#lastObservedAt = this.#timer.now();
    this.#handle = this.#timer.every(this.#intervalMs, () => this.#check());
  }

  stop(): void {
    if (this.#handle !== undefined) this.#timer.cancel(this.#handle);
    this.#handle = undefined;
    if (!this.#settled) this.#state = "stopped";
  }

  get state(): RuntimeIpcHealthState { return this.#state; }
  waitForUnhealthy(): Promise<void> { return this.#unhealthy; }

  async handle(method: string, payload: JsonValue): Promise<void> {
    if (method !== RUNTIME_IPC_HEARTBEAT_METHOD) return;
    const heartbeat = captureRuntimeIpcHeartbeat(payload);
    if (heartbeat.sequence <= this.#lastSequence) return;
    this.#lastSequence = heartbeat.sequence;
    this.#lastObservedAt = this.#timer.now();
  }

  #check(): void {
    if (this.#settled) return;
    if (this.#timer.now() - this.#lastObservedAt < this.#intervalMs * this.#missedLimit) return;
    this.#settled = true;
    this.#state = "unhealthy";
    this.stop();
    this.#resolveUnhealthy();
  }
}

export function captureRuntimeIpcHeartbeat(value: unknown): RuntimeIpcHeartbeatPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Runtime heartbeat is invalid");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !Object.hasOwn(record, "sequence") || !Object.hasOwn(record, "sentAt")) throw new TypeError("Runtime heartbeat is invalid");
  if (typeof record.sequence !== "number" || !Number.isSafeInteger(record.sequence) || record.sequence < 1) throw new TypeError("Runtime heartbeat is invalid");
  if (typeof record.sentAt !== "string" || new Date(record.sentAt).toISOString() !== record.sentAt) throw new TypeError("Runtime heartbeat is invalid");
  return Object.freeze({ sequence: record.sequence, sentAt: record.sentAt });
}

const SYSTEM_TIMER: RuntimeIpcHeartbeatTimer = Object.freeze({
  now: () => Date.now(),
  every: (intervalMs: number, callback: () => void) => setInterval(callback, intervalMs),
  cancel: (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>),
});

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Heartbeat setting must be positive");
  return value;
}
