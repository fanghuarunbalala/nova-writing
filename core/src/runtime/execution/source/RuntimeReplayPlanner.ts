/** Defines the side-effect-free startup plan reconstructed from durable Events. */
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import type { RunStateSnapshot } from "../state/RunStateMachine.js";
import type { TurnStateSnapshot } from "../state/TurnStateMachine.js";

export interface RuntimeReplayRequest {
  readonly conversationId: string;
  readonly throughSequence: number;
}

export interface RuntimeReplayPlan {
  readonly conversationId: string;
  readonly throughSequence: number;
  readonly scannedEventCount: number;
  readonly processedInputCount: number;
  readonly pendingInputs: readonly PersistedInputEventSnapshot[];
  readonly run?: RunStateSnapshot;
  readonly turn?: TurnStateSnapshot;
}

export interface RuntimeReplayPlanner {
  plan(request: RuntimeReplayRequest): Promise<RuntimeReplayPlan>;
}
