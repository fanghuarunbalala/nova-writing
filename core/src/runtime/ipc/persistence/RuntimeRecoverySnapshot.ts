/** Child-private aggregate used to recover one Runtime without exposing Store mechanics. */
import type { ContextCheckpoint } from "../../context/index.js";
import type { ToolApprovalInteractionSnapshot } from "../../interaction/index.js";
import type { PendingNudgeStoreSnapshot } from "../../nudge/index.js";

export const RUNTIME_RECOVERY_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export interface RuntimeRecoverySnapshot {
  readonly schemaVersion: typeof RUNTIME_RECOVERY_SNAPSHOT_SCHEMA_VERSION;
  readonly conversationId: string;
  readonly capturedThroughSequence: number;
  readonly nudge?: PendingNudgeStoreSnapshot;
  readonly contextCheckpoint?: ContextCheckpoint;
  readonly interaction?: ToolApprovalInteractionSnapshot;
}
