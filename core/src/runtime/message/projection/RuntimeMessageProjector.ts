/**
 * Deterministic mapping from persisted Conversation Events to model-visible
 * Runtime Message drafts. Implementations must not perform I/O, use randomness,
 * or depend on the current wall clock.
 */
import type { PersistedConversationEventSnapshot } from "../../../storage/index.js";
import type { RuntimeMessageDraft } from "../RuntimeMessageSnapshot.js";

export interface RuntimeMessageProjector {
  readonly id: string;
  readonly version: string;

  project(event: PersistedConversationEventSnapshot): readonly RuntimeMessageDraft[];
}
