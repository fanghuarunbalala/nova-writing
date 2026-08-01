/**
 * Placement-neutral command handle for one ephemeral Runtime instance.
 *
 * @example
 * ```ts
 * await handle.dispatchInput(inputReference);
 * await handle.shutdown({ reason: "host_close" });
 * const exit = await handle.waitForExit();
 * ```
 */
import type { ConversationRuntimeExit } from "./ConversationRuntimeExit.js";
import type { ConversationRuntimeInputReference } from "./ConversationRuntimeInputReference.js";
import type { ConversationRuntimeHandleShutdownRequest } from "./ConversationRuntimeShutdown.js";

export interface ConversationRuntimeHandle {
  readonly conversationId: string;
  readonly runtimeInstanceId: string;

  dispatchInput(input: ConversationRuntimeInputReference): Promise<void>;

  shutdown(request: ConversationRuntimeHandleShutdownRequest): Promise<void>;

  waitForExit(): Promise<ConversationRuntimeExit>;
}
