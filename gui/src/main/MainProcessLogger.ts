/** Main-process file logger so warnings such as subscription recovery are observable. */
import { createWriteStream, type WriteStream } from "node:fs";
import {
  noopLogger,
  type LogFields,
  type Logger,
} from "@novel/core";

export function createMainProcessLogger(logPath: string): Logger {
  if (logPath.length === 0) return noopLogger;
  // 持久写流：单个文件描述符，避免每行 appendFile 的 FD 抖动（与 child 日志器一致）。
  const stream: WriteStream = createWriteStream(logPath, { flags: "a" });
  stream.on("error", () => { /* 写流错误不崩溃进程（脱敏）；日志丢弃。 */ });
  process.on("exit", () => {
    stream.end();
  });
  const write = (
    level: string,
    event: string,
    fields?: LogFields,
  ): void => {
    stream.write(`${level} ${event} ${JSON.stringify(fields ?? {})}\n`);
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
