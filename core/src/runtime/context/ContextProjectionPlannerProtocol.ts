/** Provider-neutral inputs and private results for one-call Context projection. */
import type { RuntimeMessageSnapshot } from "../message/index.js";
import type { ContextCheckpoint, ContextCheckpointItem } from "./ContextCheckpoint.js";
import type { CompiledProviderContext } from "./ContextCompiler.js";
import type { ContextPinnedMessageGroup } from "./ContextPinnedMessageGroup.js";
import type { ContextProjection } from "./ContextProjection.js";

export interface ContextProjectionItemTokenEstimate {
  readonly itemId: string;
  readonly tokenEstimate: number;
}

export interface ContextProjectionMessageTokenEstimate {
  readonly messageId: string;
  readonly tokenEstimate: number;
}

export interface ContextProjectionCandidate {
  readonly conversationId: string;
  readonly providerCallId: string;
  readonly checkpoint?: ContextCheckpoint;
  readonly pinnedGroups: readonly ContextPinnedMessageGroup[];
  readonly recentMessageIds: readonly string[];
  readonly transientMessageCount: number;
  readonly nonMessageFixedTokens: number;
  readonly checkpointBaseTokens: number;
  readonly checkpointItemTokenEstimates: readonly ContextProjectionItemTokenEstimate[];
  readonly messageTokenEstimates: readonly ContextProjectionMessageTokenEstimate[];
  readonly transientMessageTokens: number;
  readonly hardAdmissionTokens: number;
}

export interface ContextProjectionPlan {
  readonly projection: ContextProjection;
  readonly selectedCheckpointItems: readonly ContextCheckpointItem[];
  readonly selectedPinnedMessageIds: readonly string[];
  readonly selectedRecentMessageIds: readonly string[];
}

export interface ContextProjectionCandidateRequest {
  readonly conversationId: string;
  readonly runId: string;
  readonly providerCallId: string;
  readonly canonicalMessages: readonly RuntimeMessageSnapshot[];
  readonly transientMessageCount: number;
}

export interface ContextProjectionCandidateProvider {
  load(
    request: ContextProjectionCandidateRequest,
  ): Promise<ContextProjectionCandidate>;
}

export interface ContextCheckpointOverlay {
  readonly checkpointId: string;
  readonly content: string;
}

export interface ContextProjectionProviderCallRequest {
  readonly conversationId: string;
  readonly runId: string;
  readonly providerCallId: string;
  readonly baseSystemPrompt: string;
  readonly canonicalMessages: readonly RuntimeMessageSnapshot[];
  readonly transientMessageCount: number;
}

export interface ContextProjectionProviderCallResult {
  readonly context: CompiledProviderContext;
  readonly projection: ContextProjection;
  readonly checkpointOverlay?: ContextCheckpointOverlay;
}
