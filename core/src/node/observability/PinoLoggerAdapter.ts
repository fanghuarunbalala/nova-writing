/**
 * pino-backed implementation of the platform-neutral Logger contract.
 *
 * Core stays framework-agnostic; only the node adapters depend on pino. Call
 * sites keep passing an `event` name plus JSON-safe fields, and pino renders
 * one JSON record per call with `messageKey: "event"` so the event name stays
 * the primary key of every line.
 */
import pino, { type Logger as PinoLogger } from "pino";
import type { DiagnosticLogLevel } from "../../config/index.js";
import type { LogFields, Logger } from "../../observability/index.js";

/** DiagnosticLogLevel -> pino level name. "verbose" maps to pino's trace. */
export const PINO_LEVEL: Readonly<Record<DiagnosticLogLevel, string>> =
  Object.freeze({
    error: "error",
    warn: "warn",
    info: "info",
    debug: "debug",
    verbose: "trace",
  });

export interface CreatePinoLoggerOptions {
  /** 允许落盘的最低级别；低于它的记录被 pino 丢弃。默认 "info"。 */
  readonly level?: DiagnosticLogLevel;
  /** 外部 pino 实例（如已配置 transport 的实例）；缺省创建一个纯流 pino。 */
  readonly logger?: PinoLogger;
}

export function createPinoLogger(options: CreatePinoLoggerOptions = {}): Logger {
  const base =
    options.logger ??
    pino({ messageKey: "event", level: PINO_LEVEL[options.level ?? "info"] });
  return adaptPinoLogger(base);
}

/** 把一个 pino 实例包装成自定义 Logger 接口；child 会保留 pino 的绑定继承。 */
export function adaptPinoLogger(base: PinoLogger): Logger {
  // pino 的 level 方法依赖 this 指向 logger 实例，必须先 bind。
  const debug = base.debug.bind(base);
  const info = base.info.bind(base);
  const warn = base.warn.bind(base);
  const error = base.error.bind(base);
  const trace = base.trace.bind(base);
  return {
    debug: (event, fields) => write(debug, event, fields),
    info: (event, fields) => write(info, event, fields),
    warn: (event, fields) => write(warn, event, fields),
    error: (event, fields) => write(error, event, fields),
    verbose: (event, fields) => write(trace, event, fields),
    child: (bindings) =>
      adaptPinoLogger(base.child(bindings as pino.Bindings)),
    flush: async () => {
      base.flush();
    },
  };
}

function write(
  method: (obj: object, msg?: string, ...args: unknown[]) => void,
  event: string,
  fields: LogFields | undefined,
): void {
  method({ ...(fields ?? {}) }, event);
}
