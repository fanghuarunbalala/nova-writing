/** Resolves a payload-free Host reference into one canonical durable InputEvent. */
import type { ConversationRuntimeInputReference } from "../../../conversation/host/ConversationRuntimeInputReference.js";
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";

export interface RuntimeInputResolver {
  resolve(
    reference: ConversationRuntimeInputReference,
  ): Promise<PersistedInputEventSnapshot>;
}
