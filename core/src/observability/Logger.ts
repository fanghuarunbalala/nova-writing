/**
 * Platform-neutral structured logging contract used by Core services.
 *
 * Log fields must remain JSON-safe so CLI, GUI, Web, and file adapters can
 * forward the same record without depending on one logging framework.
 *
 * @example
 * ```ts
 * logger.info("message_projection.rebuild.completed", {
 *   conversationId,
 *   messageCount,
 * });
 * ```
 */
import type { JsonValue } from "../event/index.js";

export type LogFields = Readonly<Record<string, JsonValue>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;

  info(event: string, fields?: LogFields): void;

  warn(event: string, fields?: LogFields): void;

  error(event: string, fields?: LogFields): void;

  child(bindings: LogFields): Logger;
}
