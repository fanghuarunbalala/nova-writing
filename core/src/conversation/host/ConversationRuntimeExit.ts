/** Safe Runtime exit identity without raw messages, stacks, or causes. */
import type { ConversationRuntimeShutdownReason } from "./ConversationRuntimeShutdown.js";

export type ConversationRuntimeExit =
  | Readonly<{
      kind: "stopped";
      exitedAt: string;
      reason: ConversationRuntimeShutdownReason;
    }>
  | Readonly<{
      kind: "crashed";
      exitedAt: string;
      errorName: string;
      errorCode?: string;
    }>;
