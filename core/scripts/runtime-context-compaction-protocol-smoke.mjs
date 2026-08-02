import assert from "node:assert/strict";
import {
  ARTIFACT_REFERENCE_VALIDATION_FAILURE,
  ARTIFACT_REFERENCE_SCHEMA_VERSION,
  ArtifactReferenceValidationError,
  CONTEXT_BUDGET_DEFAULTS,
  CONTEXT_CHECKPOINT_ITEM_PRIORITY,
  CONTEXT_CHECKPOINT_SCHEMA_VERSION,
  CONTEXT_COMPACTION_OUTCOME,
  CONTEXT_PIN_GROUP_KIND,
  CONTEXT_PIN_LIFETIME,
  CONTEXT_PRESSURE_LEVEL,
  CONTEXT_PROTOCOL_VALIDATION_FAILURE,
  CONTEXT_PROJECTION_DEGRADATION_LEVEL,
  CONTEXT_UNREDUCIBLE_REASON,
  ContextProtocolValidationError,
  captureArtifactReference,
  captureContextBudgetThresholds,
  captureContextCheckpoint,
  captureContextCompactionAssessment,
  captureContextCompactionAttemptIdentity,
  captureContextInputTokenEstimate,
  captureContextIrreducibleFloorEstimate,
  captureContextPinnedMessageGroup,
  captureContextPressureSnapshot,
  captureContextProjection,
  captureEffectiveContextBudget,
} from "../dist/index.js";

assert.deepEqual(CONTEXT_BUDGET_DEFAULTS, {
  softReminderRatio: 0.7,
  compactionRequestRatio: 0.82,
  targetPostCompactionRatio: 0.55,
  hardAdmissionRatio: 0.92,
  minimumNewContentRatio: 0.1,
  minimumNewContentTokens: 8_192,
  minimumSavingsRatio: 0.05,
  minimumSavingsTokens: 2_048,
});

assert.equal(ARTIFACT_REFERENCE_SCHEMA_VERSION, 1);
assert.equal(CONTEXT_CHECKPOINT_SCHEMA_VERSION, 1);
assert.deepEqual(Object.values(CONTEXT_PRESSURE_LEVEL), [
  "normal",
  "soft",
  "compaction",
  "hard",
]);
assert.deepEqual(Object.values(CONTEXT_COMPACTION_OUTCOME), [
  "target_met",
  "reduced",
  "degraded",
  "unreducible",
]);
assert.deepEqual(Object.values(CONTEXT_PIN_LIFETIME), [
  "permanent",
  "conditional",
  "sliding",
]);
assert.deepEqual(Object.values(CONTEXT_CHECKPOINT_ITEM_PRIORITY), [
  "critical",
  "high",
  "normal",
  "low",
]);
assert.deepEqual(CONTEXT_PROJECTION_DEGRADATION_LEVEL, {
  none: 0,
  strongerStructured: 1,
  artifactOffload: 2,
  priorityBudgeted: 3,
  recentWindowReduced: 4,
});
assert.equal(CONTEXT_PIN_GROUP_KIND.activeToolExecution, "active_tool_execution");
assert.equal(
  CONTEXT_UNREDUCIBLE_REASON.compactionInsufficient,
  "compaction_insufficient",
);

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const digestC = `sha256:${"c".repeat(64)}`;

const artifactSource = {
  schemaVersion: ARTIFACT_REFERENCE_SCHEMA_VERSION,
  artifactId: "artifact_1",
  conversationId: "conversation-1",
  contentType: "text/plain",
  byteLength: 120_000,
  tokenEstimate: 30_000,
  digest: digestA,
  filename: "chapter-archive.txt",
};
const artifact = captureArtifactReference(artifactSource);
assert.equal(Object.isFrozen(artifact), true);
artifactSource.filename = "mutated.txt";
assert.equal(artifact.filename, "chapter-archive.txt");

assert.throws(
  () =>
    captureArtifactReference({
      ...artifactSource,
      artifactId: "/private/local/path",
    }),
  (error) =>
    error instanceof ArtifactReferenceValidationError &&
    error.failure === ARTIFACT_REFERENCE_VALIDATION_FAILURE.invalidReference,
);

const thresholds = captureContextBudgetThresholds(CONTEXT_BUDGET_DEFAULTS);
const budget = captureEffectiveContextBudget({
  providerContextWindowTokens: 131_072,
  reservedOutputTokens: 20_000,
  protocolOverheadTokens: 5_000,
  safetyReserveTokens: 6_072,
  effectiveInputTokens: 100_000,
  thresholds,
});
const estimate = captureContextInputTokenEstimate({
  baseSystemPromptTokens: 5_000,
  toolSchemaTokens: 5_000,
  checkpointOverlayTokens: 10_000,
  nudgeReserveTokens: 1_000,
  pinnedMessageTokens: 10_000,
  currentInputTokens: 10_000,
  recentMessageTokens: 30_000,
  transientMessageTokens: 12_000,
  totalInputTokens: 83_000,
});
const floor = captureContextIrreducibleFloorEstimate({
  baseSystemPromptTokens: 5_000,
  toolSchemaTokens: 5_000,
  pinnedMessageTokens: 10_000,
  currentInputTokens: 10_000,
  transientMessageTokens: 12_000,
  totalTokens: 42_000,
});
const pressure = captureContextPressureSnapshot({
  conversationId: "conversation-1",
  runId: "run-1",
  providerCallId: "provider-call-1",
  evaluatedAt: "2026-08-02T01:00:00.000Z",
  budget,
  estimate,
  irreducibleFloor: floor,
  usageRatio: 0.83,
  level: CONTEXT_PRESSURE_LEVEL.compaction,
});
assert.equal(Object.isFrozen(pressure), true);
assert.equal(Object.isFrozen(pressure.budget.thresholds), true);

const pinned = captureContextPinnedMessageGroup({
  id: "pin-current-input",
  conversationId: "conversation-1",
  kind: CONTEXT_PIN_GROUP_KIND.currentInput,
  lifetime: CONTEXT_PIN_LIFETIME.sliding,
  messageIds: ["message-81"],
  tokenEstimate: 10_000,
  runId: "run-1",
  turnId: "turn-1",
});
assert.equal(Object.isFrozen(pinned.messageIds), true);

const checkpointSource = {
  schemaVersion: CONTEXT_CHECKPOINT_SCHEMA_VERSION,
  id: "checkpoint-1",
  conversationId: "conversation-1",
  sourceStartSequence: 1,
  sourceEndSequence: 80,
  coveredThroughSequence: 80,
  sourceDigest: digestB,
  summary: "Structured historical summary",
  facts: [
    {
      id: "fact-1",
      text: "A durable fact",
      priority: CONTEXT_CHECKPOINT_ITEM_PRIORITY.high,
      sourceMessageIds: ["message-1"],
      artifactReferences: [artifact],
    },
  ],
  decisions: [],
  constraints: [],
  unresolvedTasks: [],
  pinnedMessageIds: ["message-81"],
  recentWindowStartSequence: 81,
  tokenEstimateBefore: 83_000,
  tokenEstimateAfter: 50_000,
  compactorId: "compactor-1",
  compactorVersion: "1",
  createdAt: "2026-08-02T01:00:01.000Z",
  contentDigest: digestC,
};
const checkpoint = captureContextCheckpoint(checkpointSource);
assert.equal(Object.isFrozen(checkpoint), true);
assert.equal(Object.isFrozen(checkpoint.facts[0].artifactReferences), true);
checkpointSource.facts[0].text = "mutated private content";
assert.equal(checkpoint.facts[0].text, "A durable fact");

const projection = captureContextProjection({
  conversationId: "conversation-1",
  providerCallId: "provider-call-1",
  checkpointId: checkpoint.id,
  selectedCheckpointItemIds: ["fact-1"],
  omittedCheckpointItemIds: [],
  pinnedMessageIds: ["message-81"],
  recentMessageIds: ["message-82", "message-83"],
  transientMessageCount: 1,
  degradationLevel: CONTEXT_PROJECTION_DEGRADATION_LEVEL.none,
  tokenEstimate: 50_000,
});
assert.equal(Object.isFrozen(projection.selectedCheckpointItemIds), true);

const attempt = captureContextCompactionAttemptIdentity({
  conversationId: "conversation-1",
  sourceDigest: digestB,
  compactorId: "compactor-1",
  compactorVersion: "1",
});
assert.equal(Object.isFrozen(attempt), true);

function assessment(overrides) {
  return captureContextCompactionAssessment({
    conversationId: "conversation-1",
    runId: "run-1",
    providerCallId: "provider-call-1",
    tokenEstimateBefore: 100,
    irreducibleFloorTokens: 40,
    targetTokens: 55,
    compactionRequestTokens: 82,
    hardAdmissionTokens: 92,
    minimumSavingsTokens: 5,
    completedAt: "2026-08-02T01:00:02.000Z",
    ...overrides,
  });
}

assert.equal(
  assessment({
    outcome: CONTEXT_COMPACTION_OUTCOME.targetMet,
    tokenEstimateAfter: 50,
    targetAchieved: true,
    meaningfulReduction: true,
    checkpointId: "checkpoint-target",
  }).outcome,
  CONTEXT_COMPACTION_OUTCOME.targetMet,
);
assert.equal(
  assessment({
    outcome: CONTEXT_COMPACTION_OUTCOME.reduced,
    tokenEstimateAfter: 70,
    targetAchieved: false,
    meaningfulReduction: true,
    checkpointId: "checkpoint-reduced",
  }).outcome,
  CONTEXT_COMPACTION_OUTCOME.reduced,
);
assert.equal(
  assessment({
    outcome: CONTEXT_COMPACTION_OUTCOME.degraded,
    tokenEstimateAfter: 85,
    targetAchieved: false,
    meaningfulReduction: true,
    checkpointId: "checkpoint-degraded",
  }).outcome,
  CONTEXT_COMPACTION_OUTCOME.degraded,
);
assert.equal(
  assessment({
    outcome: CONTEXT_COMPACTION_OUTCOME.unreducible,
    tokenEstimateAfter: 95,
    irreducibleFloorTokens: 95,
    targetAchieved: false,
    meaningfulReduction: true,
    unreducibleReason: CONTEXT_UNREDUCIBLE_REASON.pinnedContextTooLarge,
  }).outcome,
  CONTEXT_COMPACTION_OUTCOME.unreducible,
);

assert.throws(
  () =>
    captureContextProjection({
      ...projection,
      omittedCheckpointItemIds: ["fact-1"],
    }),
  (error) =>
    error instanceof ContextProtocolValidationError &&
    error.failure === CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidProjection,
);

assert.throws(
  () =>
    assessment({
      outcome: CONTEXT_COMPACTION_OUTCOME.targetMet,
      tokenEstimateAfter: 85,
      targetAchieved: false,
      meaningfulReduction: true,
      checkpointId: "checkpoint-invalid",
    }),
  (error) =>
    error instanceof ContextProtocolValidationError &&
    error.failure === CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidAssessment &&
    error.message.includes("mutated private content") === false,
);
