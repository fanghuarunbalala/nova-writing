/** Main-process file logger so warnings such as subscription recovery are observable. */
import { appendFile } from "node:fs/promises";
import {
  noopLogger,
  type LogFields,
  type Logger,
} from "@novel/core";

export function createMainProcessLogger(logPath: string): Logger {
  if (logPath.length === 0) return noopLogger;
  const write = (
    level: string,
    event: string,
    fields?: LogFields,
  ): void => {
    void appendFile(
      logPath,
      `${level} ${event} ${JSON.stringify(fields ?? {})}\n`,
      "utf8",
    ).catch(() => undefined);
  };
  const fileLogger: Logger = {
    debug: (event, fields) => write("DEBUG", event, fields),
    info: (event, fields) => write("INFO", event, fields),
    warn: (event, fields) => write("WARN", event, fields),
    error: (event, fields) => write("ERROR", event, fields),
    child: () => fileLogger,
  };
  return fileLogger;
}
