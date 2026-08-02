/** Atomic Store port for immutable Checkpoints and durable Compaction attempts. */
import type { ContextCheckpoint } from "./ContextCheckpoint.js";
import type { ContextCompactionAssessment, ContextCompactionAttemptIdentity } from "./ContextCompactionProtocol.js";
import type {
  ContextCompactionAttemptFailure,
  ContextCompactionAttemptRecord,
  ContextCompactionReservationResult,
} from "./ContextCompactionManagerProtocol.js";

export interface ContextCompactionAttemptReservation {
  readonly identity: ContextCompactionAttemptIdentity;
  readonly runId: string;
  readonly providerCallId: string;
  readonly requestedAt: string;
  readonly expectedParentCheckpointId?: string;
}

export interface ContextCompactionAttemptFinalization {
  readonly identity: ContextCompactionAttemptIdentity;
  readonly assessment: ContextCompactionAssessment;
  readonly checkpoint?: ContextCheckpoint;
}

export interface ContextCompactionAttemptFailureRequest {
  readonly identity: ContextCompactionAttemptIdentity;
  readonly failure: ContextCompactionAttemptFailure;
  readonly completedAt: string;
}

export interface ContextCompactionFinalizationResult {
  readonly attempt: ContextCompactionAttemptRecord;
  readonly checkpoint?: ContextCheckpoint;
  readonly unchanged: boolean;
}

export interface ContextCompactionFailureResult {
  readonly attempt: ContextCompactionAttemptRecord;
  readonly unchanged: boolean;
}

export interface ContextCheckpointStore {
  getActive(conversationId: string): Promise<ContextCheckpoint | undefined>;

  reserveAttempt(
    request: ContextCompactionAttemptReservation,
  ): Promise<ContextCompactionReservationResult>;

  finalizeAttempt(
    request: ContextCompactionAttemptFinalization,
  ): Promise<ContextCompactionFinalizationResult>;

  failAttempt(
    request: ContextCompactionAttemptFailureRequest,
  ): Promise<ContextCompactionFailureResult>;
}
