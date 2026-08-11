/**
 * Daily-rotating file logger built on pino + pino-roll.
 *
 * Replaces the hand-rolled write-stream loggers (main process and child
 * runtime): pino-roll appends a date suffix on rotation and prunes files older
 * than the retention window, and pino enforces the configured minimum level so
 * DEBUG/verbose floods never reach disk by default.
 */
import { createRequire } from "node:module";
import pino from "pino";
import type { DiagnosticLogLevel } from "../../config/index.js";
import type { Logger } from "../../observability/index.js";
import { PINO_LEVEL, adaptPinoLogger } from "./PinoLoggerAdapter.js";

const require = createRequire(import.meta.url);
// pino 的 worker transport 从 pino 自身目录解析 target；pnpm 严格 node_modules 下
// pino-roll 不在 pino 的依赖里，worker 会加载失败。这里自行解析出绝对路径传入。
const PINO_ROLL_TARGET = require.resolve("pino-roll");

export interface CreateRotatingFileLoggerOptions {
  /** 日志文件路径；父目录由 pino-roll 自动创建（mkdir）。 */
  readonly file: string;
  /** 允许落盘的最低级别；默认 "info"。 */
  readonly level?: DiagnosticLogLevel;
  /** 保留的旋转文件数（不含活动文件）；按天切分。默认 7。 */
  readonly retentionCount?: number;
}

export function createRotatingFileLogger(
  options: CreateRotatingFileLoggerOptions,
): Logger {
  const transport = pino.transport({
    target: PINO_ROLL_TARGET,
    options: {
      file: options.file,
      frequency: "daily",
      mkdir: true,
      limit: { count: options.retentionCount ?? 7 },
    },
  });
  // 写流错误不崩溃进程（脱敏）；日志丢弃。Error on the destination is swallowed:
  // a failed log write must never take the process down.
  transport.on("error", () => {});
  const base = pino(
    { messageKey: "event", level: PINO_LEVEL[options.level ?? "info"] },
    transport,
  );
  return adaptPinoLogger(base);
}
