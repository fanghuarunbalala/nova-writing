/** Mutable Host-owned state for one logical Conversation Runtime slot. */
import type { RuntimePresence } from "../RuntimePresence.js";
import type { ConversationRuntimeExit } from "./ConversationRuntimeExit.js";
import type { ConversationRuntimeHandle } from "./ConversationRuntimeHandle.js";
import { ConversationHostSignalQueue } from "./ConversationHostSignalQueue.js";

export interface ManagedConversationRuntimeSlot {
  readonly conversationId: string;
  generation: number;
  verified: boolean;
  presence: RuntimePresence;
  handle?: ConversationRuntimeHandle;
  exitPromise?: Promise<ConversationRuntimeExit>;
  readonly pendingControlSignals: ConversationHostSignalQueue;
  readonly pendingRuntimeSignals: ConversationHostSignalQueue;
  readonly knownSignalFingerprints: Map<number, string>;
  readonly dispatchedRuntimeSignals: Map<number, string>;
  readonly completedControlSignals: Map<number, string>;
  readonly completedOfflineRuntimeSignals: Map<number, string>;
  drainScheduled: boolean;
  signalRevision: number;
}

export function createManagedConversationRuntimeSlot(options: {
  conversationId: string;
  observedAt: string;
  controlQueueCapacity: number;
  runtimeQueueCapacity: number;
  verified: boolean;
}): ManagedConversationRuntimeSlot {
  return {
    conversationId: options.conversationId,
    generation: 0,
    verified: options.verified,
    presence: Object.freeze({ state: "offline", observedAt: options.observedAt }),
    pendingControlSignals: new ConversationHostSignalQueue(
      options.controlQueueCapacity,
    ),
    pendingRuntimeSignals: new ConversationHostSignalQueue(
      options.runtimeQueueCapacity,
    ),
    knownSignalFingerprints: new Map(),
    dispatchedRuntimeSignals: new Map(),
    completedControlSignals: new Map(),
    completedOfflineRuntimeSignals: new Map(),
    drainScheduled: false,
    signalRevision: 0,
  };
}
