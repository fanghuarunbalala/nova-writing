/**
 * Runtime placement boundary implemented later by in-process, worker,
 * child-process, or remote launchers.
 */
import type { ConversationRuntimeBootstrap } from "./ConversationRuntimeBootstrap.js";
import type { ConversationRuntimeHandle } from "./ConversationRuntimeHandle.js";

export interface ConversationRuntimePlacement {
  activate(
    bootstrap: ConversationRuntimeBootstrap,
  ): Promise<ConversationRuntimeHandle>;
}
