/**
 * Main-process logger backed by the daily-rotating pino file adapter.
 *
 * Empty logPath keeps the historical "disabled" contract (no-op logger); a real
 * path yields a rotating file logger whose minimum level is configurable.
 */
import {
  noopLogger,
  type DiagnosticLogLevel,
  type Logger,
} from "@novel/core";
import { createRotatingFileLogger } from "@novel/core/node";

export function createMainProcessLogger(
  logPath: string,
  level?: DiagnosticLogLevel,
): Logger {
  if (logPath.length === 0) return noopLogger;
  return createRotatingFileLogger({ file: logPath, level });
}
