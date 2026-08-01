/**
 * Persists validated OutputEvents before best-effort live publication.
 *
 * @example
 * ```ts
 * const receipt = await publisher.publish(outputEvent);
 * ```
 */
import type { OutputEvent } from "../../event/index.js";
import type { OutputReceipt } from "./OutputReceipt.js";

export interface ConversationOutputEventPublisher {
  publish(event: OutputEvent): Promise<OutputReceipt>;
}
