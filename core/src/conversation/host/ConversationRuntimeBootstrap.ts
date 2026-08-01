/**
 * Serializable Core bootstrap identity for one Runtime activation.
 *
 * Store paths, Provider credentials, Tool handlers, prompts, clients, and
 * process placement are intentionally absent from this contract.
 */
import type { ConversationSnapshot } from "../ConversationSnapshot.js";
import type { ConversationRuntimeActivationCause } from "./ConversationRuntimeActivation.js";

export const CONVERSATION_RUNTIME_BOOTSTRAP_SCHEMA_VERSION = 1 as const;

export interface ConversationRuntimeWorkspace {
  readonly workspaceId: string;
  readonly workdir: string;
}

export interface ConversationRuntimeJournalBootstrap {
  readonly highWatermark: number;
}

export interface ConversationRuntimeBootstrap {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_BOOTSTRAP_SCHEMA_VERSION;
  readonly runtimeInstanceId: string;
  readonly activatedAt: string;
  readonly conversation: ConversationSnapshot;
  readonly workspace: ConversationRuntimeWorkspace;
  readonly activation: ConversationRuntimeActivationCause;
  readonly journal: ConversationRuntimeJournalBootstrap;
}
