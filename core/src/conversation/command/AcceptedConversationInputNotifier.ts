/**
 * Schedules Host work after an InputEvent has entered the durable Journal.
 *
 * Implementations must be idempotent by Conversation ID and Journal Sequence.
 * A notification is a wake-up hint; Journal replay remains the recovery path.
 */
import type { AcceptedConversationInputSignal } from "./AcceptedConversationInputSignal.js";

export interface AcceptedConversationInputNotifier {
  notifyAccepted(signal: AcceptedConversationInputSignal): Promise<void>;
}
