/** Default logger used when an application has not injected a logging adapter. */
import type { LogFields, Logger } from "./Logger.js";

class NoopLogger implements Logger {
  debug(_event: string, _fields?: LogFields): void {}

  info(_event: string, _fields?: LogFields): void {}

  warn(_event: string, _fields?: LogFields): void {}

  error(_event: string, _fields?: LogFields): void {}

  child(_bindings: LogFields): Logger {
    return this;
  }
}

export const noopLogger: Logger = new NoopLogger();
