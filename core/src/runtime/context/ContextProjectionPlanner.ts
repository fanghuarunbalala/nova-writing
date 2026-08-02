/** Maximizes retained Context under the strict Provider hard-admission boundary. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  CONTEXT_CHECKPOINT_ITEM_PRIORITY,
  type ContextCheckpointItem,
  type ContextCheckpointItemPriority,
} from "./ContextCheckpoint.js";
import { captureContextCheckpoint } from "./ContextCheckpointValidator.js";
import { captureContextPinnedMessageGroup } from "./ContextPinnedMessageGroupValidator.js";
import {
  CONTEXT_PROJECTION_DEGRADATION_LEVEL,
  type ContextProjection,
} from "./ContextProjection.js";
import { captureContextProjection } from "./ContextProjectionValidator.js";
import {
  CONTEXT_PROJECTION_PLANNER_FAILURE,
  ContextProjectionPlannerError,
} from "./ContextProjectionPlannerErrors.js";
import type {
  ContextProjectionCandidate,
  ContextProjectionItemTokenEstimate,
  ContextProjectionMessageTokenEstimate,
  ContextProjectionPlan,
} from "./ContextProjectionPlannerProtocol.js";

const OMIT_PRIORITY_ORDER: readonly ContextCheckpointItemPriority[] = [
  CONTEXT_CHECKPOINT_ITEM_PRIORITY.low,
  CONTEXT_CHECKPOINT_ITEM_PRIORITY.normal,
  CONTEXT_CHECKPOINT_ITEM_PRIORITY.high,
];

export interface ContextProjectionPlannerOptions {
  readonly logger?: Logger;
}

export class ContextProjectionPlanner {
  private readonly logger: Logger;

  constructor(options: ContextProjectionPlannerOptions = {}) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "context_projection_planner",
    });
  }

  plan(candidate: ContextProjectionCandidate): ContextProjectionPlan {
    let captured: CapturedProjectionCandidate;
    try {
      captured = captureCandidate(candidate);
    } catch {
      const error = failure(
        CONTEXT_PROJECTION_PLANNER_FAILURE.invalidCandidate,
        candidate,
      );
      this.logFailure(error);
      throw error;
    }

    const selectedItemIds = new Set(
      captured.checkpointItems.map((item) => item.id),
    );
    const omittedItemIds = new Set<string>();
    const selectedRecentMessageIds = [...captured.recentMessageIds];
    let tokenEstimate = calculateTokenEstimate(
      captured,
      selectedItemIds,
      selectedRecentMessageIds,
    );

    for (const priority of OMIT_PRIORITY_ORDER) {
      const candidates = captured.checkpointItems
        .filter((item) => item.priority === priority)
        .reverse();
      for (const item of candidates) {
        if (tokenEstimate < captured.hardAdmissionTokens) break;
        const itemTokenEstimate = captured.itemTokens.get(item.id)!;
        if (itemTokenEstimate === 0) continue;
        selectedItemIds.delete(item.id);
        omittedItemIds.add(item.id);
        tokenEstimate -= itemTokenEstimate;
      }
    }

    while (
      tokenEstimate >= captured.hardAdmissionTokens &&
      selectedRecentMessageIds.length > 0
    ) {
      const removed = selectedRecentMessageIds.shift()!;
      tokenEstimate -= captured.messageTokens.get(removed)!;
    }

    if (tokenEstimate >= captured.hardAdmissionTokens) {
      const error = failure(
        CONTEXT_PROJECTION_PLANNER_FAILURE.contextUnreducible,
        captured,
      );
      this.logFailure(error);
      throw error;
    }

    const selectedCheckpointItems = Object.freeze(
      captured.checkpointItems.filter((item) => selectedItemIds.has(item.id)),
    );
    const selectedCheckpointItemIds = Object.freeze(
      selectedCheckpointItems.map((item) => item.id),
    );
    const omittedCheckpointItemIds = Object.freeze(
      captured.checkpointItems
        .filter((item) => omittedItemIds.has(item.id))
        .map((item) => item.id),
    );
    const degradationLevel =
      selectedRecentMessageIds.length < captured.recentMessageIds.length
        ? CONTEXT_PROJECTION_DEGRADATION_LEVEL.recentWindowReduced
        : omittedCheckpointItemIds.length > 0
          ? CONTEXT_PROJECTION_DEGRADATION_LEVEL.priorityBudgeted
          : CONTEXT_PROJECTION_DEGRADATION_LEVEL.none;
    const projection = captureContextProjection({
      conversationId: captured.conversationId,
      providerCallId: captured.providerCallId,
      ...(captured.checkpoint === undefined
        ? {}
        : { checkpointId: captured.checkpoint.id }),
      selectedCheckpointItemIds,
      omittedCheckpointItemIds,
      pinnedMessageIds: captured.pinnedMessageIds,
      recentMessageIds: selectedRecentMessageIds,
      transientMessageCount: captured.transientMessageCount,
      degradationLevel,
      tokenEstimate,
    });
    this.logger.info("runtime.context.projection_planned", {
      conversationId: captured.conversationId,
      providerCallId: captured.providerCallId,
      checkpointId: captured.checkpoint?.id ?? "none",
      selectedCheckpointItemCount: selectedCheckpointItemIds.length,
      omittedCheckpointItemCount: omittedCheckpointItemIds.length,
      pinnedMessageCount: captured.pinnedMessageIds.length,
      recentMessageCount: selectedRecentMessageIds.length,
      transientMessageCount: captured.transientMessageCount,
      degradationLevel,
      tokenEstimate,
    });
    return Object.freeze({
      projection,
      selectedCheckpointItems,
      selectedPinnedMessageIds: captured.pinnedMessageIds,
      selectedRecentMessageIds: Object.freeze(selectedRecentMessageIds),
    });
  }

  private logFailure(error: ContextProjectionPlannerError): void {
    this.logger.error("runtime.context.projection_failed", {
      failure: error.failure,
      ...(error.conversationId
        ? { conversationId: error.conversationId }
        : {}),
      ...(error.providerCallId
        ? { providerCallId: error.providerCallId }
        : {}),
      ...(error.checkpointId ? { checkpointId: error.checkpointId } : {}),
    });
  }
}

interface CapturedProjectionCandidate extends ContextProjectionCandidate {
  readonly checkpointItems: readonly ContextCheckpointItem[];
  readonly pinnedMessageIds: readonly string[];
  readonly itemTokens: ReadonlyMap<string, number>;
  readonly messageTokens: ReadonlyMap<string, number>;
}

function captureCandidate(
  candidate: ContextProjectionCandidate,
): CapturedProjectionCandidate {
  if (candidate === null || typeof candidate !== "object") throw new Error();
  const conversationId = requireNonBlank(candidate.conversationId);
  const providerCallId = requireNonBlank(candidate.providerCallId);
  const checkpoint =
    candidate.checkpoint === undefined
      ? undefined
      : captureContextCheckpoint(candidate.checkpoint);
  if (checkpoint !== undefined && checkpoint.conversationId !== conversationId) {
    throw new Error();
  }
  if (!Array.isArray(candidate.pinnedGroups)) throw new Error();
  const pinnedGroups = Object.freeze(
    candidate.pinnedGroups.map((group) => {
      const captured = captureContextPinnedMessageGroup(group);
      if (captured.conversationId !== conversationId) throw new Error();
      return captured;
    }),
  );
  if (new Set(pinnedGroups.map((group) => group.id)).size !== pinnedGroups.length) {
    throw new Error();
  }
  const pinnedMessageIds = collectPinnedMessageIds(pinnedGroups);
  const recentMessageIds = captureUniqueStrings(candidate.recentMessageIds);
  if (recentMessageIds.some((messageId) => pinnedMessageIds.includes(messageId))) {
    throw new Error();
  }
  const transientMessageCount = requireNonNegativeInteger(
    candidate.transientMessageCount,
  );
  const nonMessageFixedTokens = requireNonNegativeInteger(
    candidate.nonMessageFixedTokens,
  );
  const checkpointBaseTokens = requireNonNegativeInteger(
    candidate.checkpointBaseTokens,
  );
  const transientMessageTokens = requireNonNegativeInteger(
    candidate.transientMessageTokens,
  );
  const hardAdmissionTokens = requirePositiveInteger(
    candidate.hardAdmissionTokens,
  );
  const checkpointItems = checkpoint === undefined ? [] : flattenItems(checkpoint);
  const itemTokens = captureTokenEstimates(
    candidate.checkpointItemTokenEstimates,
    checkpointItems.map((item) => item.id),
    "itemId",
  );
  const allMessageIds = [...pinnedMessageIds, ...recentMessageIds];
  const messageTokens = captureTokenEstimates(
    candidate.messageTokenEstimates,
    allMessageIds,
    "messageId",
  );
  if (
    (checkpoint === undefined &&
      (checkpointBaseTokens !== 0 || checkpointItems.length !== 0)) ||
    (checkpoint !== undefined && checkpointItems.length !== itemTokens.size)
  ) {
    throw new Error();
  }
  requireNonNegativeInteger(
    nonMessageFixedTokens +
      checkpointBaseTokens +
      [...itemTokens.values()].reduce((total, tokens) => total + tokens, 0) +
      [...messageTokens.values()].reduce((total, tokens) => total + tokens, 0) +
      transientMessageTokens,
  );
  return Object.freeze({
    conversationId,
    providerCallId,
    ...(checkpoint === undefined ? {} : { checkpoint }),
    pinnedGroups,
    recentMessageIds,
    transientMessageCount,
    nonMessageFixedTokens,
    checkpointBaseTokens,
    checkpointItemTokenEstimates: candidate.checkpointItemTokenEstimates,
    messageTokenEstimates: candidate.messageTokenEstimates,
    transientMessageTokens,
    hardAdmissionTokens,
    checkpointItems: Object.freeze(checkpointItems),
    pinnedMessageIds,
    itemTokens,
    messageTokens,
  });
}

function calculateTokenEstimate(
  candidate: CapturedProjectionCandidate,
  selectedItemIds: ReadonlySet<string>,
  selectedRecentMessageIds: readonly string[],
): number {
  return (
    candidate.nonMessageFixedTokens +
    candidate.checkpointBaseTokens +
    candidate.checkpointItems.reduce(
      (total, item) =>
        total + (selectedItemIds.has(item.id) ? candidate.itemTokens.get(item.id)! : 0),
      0,
    ) +
    candidate.pinnedMessageIds.reduce(
      (total, messageId) => total + candidate.messageTokens.get(messageId)!,
      0,
    ) +
    selectedRecentMessageIds.reduce(
      (total, messageId) => total + candidate.messageTokens.get(messageId)!,
      0,
    ) +
    candidate.transientMessageTokens
  );
}

function flattenItems(checkpoint: NonNullable<ContextProjectionCandidate["checkpoint"]>) {
  return [
    ...checkpoint.facts,
    ...checkpoint.decisions,
    ...checkpoint.constraints,
    ...checkpoint.unresolvedTasks,
  ];
}

function collectPinnedMessageIds(
  groups: readonly { readonly messageIds: readonly string[] }[],
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const messageId of group.messageIds) {
      if (seen.has(messageId)) continue;
      seen.add(messageId);
      result.push(messageId);
    }
  }
  return Object.freeze(result);
}

function captureTokenEstimates<
  T extends ContextProjectionItemTokenEstimate | ContextProjectionMessageTokenEstimate,
>(value: readonly T[], expectedIds: readonly string[], idField: "itemId" | "messageId") {
  if (!Array.isArray(value)) throw new Error();
  const estimates = new Map<string, number>();
  for (const estimate of value) {
    if (estimate === null || typeof estimate !== "object") throw new Error();
    const id = requireNonBlank(estimate[idField]);
    if (estimates.has(id)) throw new Error();
    estimates.set(id, requireNonNegativeInteger(estimate.tokenEstimate));
  }
  if (
    estimates.size !== expectedIds.length ||
    expectedIds.some((id) => !estimates.has(id))
  ) {
    throw new Error();
  }
  return estimates;
}

function captureUniqueStrings(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) throw new Error();
  const captured = value.map(requireNonBlank);
  if (new Set(captured).size !== captured.length) throw new Error();
  return Object.freeze(captured);
}

function requireNonBlank(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error();
  return value;
}

function requireNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error();
  }
  return value;
}

function requirePositiveInteger(value: unknown): number {
  const captured = requireNonNegativeInteger(value);
  if (captured < 1) throw new Error();
  return captured;
}

function failure(
  reason: typeof CONTEXT_PROJECTION_PLANNER_FAILURE.invalidCandidate | typeof CONTEXT_PROJECTION_PLANNER_FAILURE.contextUnreducible,
  candidate: Partial<ContextProjectionCandidate>,
): ContextProjectionPlannerError {
  return new ContextProjectionPlannerError(
    reason,
    captureNonBlank(candidate?.conversationId),
    undefined,
    captureNonBlank(candidate?.providerCallId),
    captureNonBlank(candidate?.checkpoint?.id),
  );
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
