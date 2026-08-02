import assert from "node:assert/strict";
import {
  ARTIFACT_REFERENCE_SCHEMA_VERSION,
  CONTEXT_CHECKPOINT_ITEM_PRIORITY,
  CONTEXT_CHECKPOINT_SCHEMA_VERSION,
  CONTEXT_PIN_GROUP_KIND,
  CONTEXT_PIN_LIFETIME,
  CONTEXT_PROJECTION_DEGRADATION_LEVEL,
  CONTEXT_PROJECTION_PLANNER_FAILURE,
  ContextCheckpointOverlayRenderer,
  ContextProjectionPlanner,
  ContextProjectionPlannerError,
  ContextProjectionProviderCallCoordinator,
} from "../dist/index.js";

const privateMarker = "PRIVATE_PROJECTION_CONTENT_MUST_NOT_APPEAR";
const localPathMarker = "/private/projection/secret.txt";
const logs = [];
const logger = {
  debug: (event, fields = {}) => logs.push({ level: "debug", event, fields }),
  info: (event, fields = {}) => logs.push({ level: "info", event, fields }),
  warn: (event, fields = {}) => logs.push({ level: "warn", event, fields }),
  error: (event, fields = {}) => logs.push({ level: "error", event, fields }),
  child: () => logger,
};

const planner = new ContextProjectionPlanner({ logger });
const renderer = new ContextCheckpointOverlayRenderer();
const digest = `sha256:${"a".repeat(64)}`;

function item(id, priority) {
  return {
    id,
    text: `${privateMarker}:${id}`,
    priority,
    sourceMessageIds: [`source-${id}`],
    artifactReferences:
      id === "low-2"
        ? [
            {
              schemaVersion: ARTIFACT_REFERENCE_SCHEMA_VERSION,
              artifactId: "artifact-projection-1",
              conversationId: "conversation-1",
              contentType: "text/plain",
              byteLength: 128,
              tokenEstimate: 32,
              digest,
              filename: "safe-display-name.txt",
            },
          ]
        : [],
  };
}

const checkpoint = {
  schemaVersion: CONTEXT_CHECKPOINT_SCHEMA_VERSION,
  id: "checkpoint-1",
  conversationId: "conversation-1",
  sourceStartSequence: 1,
  sourceEndSequence: 10,
  coveredThroughSequence: 10,
  sourceDigest: digest,
  summary: `${privateMarker}:summary`,
  facts: [
    item("critical-1", CONTEXT_CHECKPOINT_ITEM_PRIORITY.critical),
    item("high-1", CONTEXT_CHECKPOINT_ITEM_PRIORITY.high),
  ],
  decisions: [item("normal-1", CONTEXT_CHECKPOINT_ITEM_PRIORITY.normal)],
  constraints: [
    item("low-1", CONTEXT_CHECKPOINT_ITEM_PRIORITY.low),
    item("low-2", CONTEXT_CHECKPOINT_ITEM_PRIORITY.low),
  ],
  unresolvedTasks: [],
  pinnedMessageIds: ["message-pinned"],
  recentWindowStartSequence: 11,
  tokenEstimateBefore: 1_000,
  tokenEstimateAfter: 500,
  compactorId: "compactor-1",
  compactorVersion: "1",
  createdAt: "2026-08-02T04:00:00.000Z",
  contentDigest: digest,
};

const pinnedGroups = [
  {
    id: "pin-latest-turn",
    conversationId: "conversation-1",
    kind: CONTEXT_PIN_GROUP_KIND.latestCompleteTurn,
    lifetime: CONTEXT_PIN_LIFETIME.sliding,
    messageIds: ["message-pinned"],
    tokenEstimate: 50,
    runId: "run-1",
    turnId: "turn-pinned",
  },
];

function candidate(overrides = {}) {
  return {
    conversationId: "conversation-1",
    providerCallId: "provider-call-1",
    checkpoint,
    pinnedGroups,
    recentMessageIds: ["message-recent-1", "message-recent-2"],
    transientMessageCount: 1,
    nonMessageFixedTokens: 100,
    checkpointBaseTokens: 50,
    checkpointItemTokenEstimates: [
      { itemId: "critical-1", tokenEstimate: 100 },
      { itemId: "high-1", tokenEstimate: 80 },
      { itemId: "normal-1", tokenEstimate: 60 },
      { itemId: "low-1", tokenEstimate: 40 },
      { itemId: "low-2", tokenEstimate: 30 },
    ],
    messageTokenEstimates: [
      { messageId: "message-pinned", tokenEstimate: 50 },
      { messageId: "message-recent-1", tokenEstimate: 70 },
      { messageId: "message-recent-2", tokenEstimate: 60 },
    ],
    transientMessageTokens: 20,
    hardAdmissionTokens: 1_000,
    ...overrides,
  };
}

const complete = planner.plan(candidate());
assert.equal(complete.projection.degradationLevel, CONTEXT_PROJECTION_DEGRADATION_LEVEL.none);
assert.deepEqual(complete.projection.selectedCheckpointItemIds, [
  "critical-1",
  "high-1",
  "normal-1",
  "low-1",
  "low-2",
]);
assert.deepEqual(complete.projection.recentMessageIds, [
  "message-recent-1",
  "message-recent-2",
]);
assert.equal(complete.projection.tokenEstimate, 660);
assert.equal(Object.isFrozen(complete), true);
assert.equal(Object.isFrozen(complete.selectedCheckpointItems), true);
assert.equal(Object.isFrozen(complete.projection), true);

const lowOnly = planner.plan(candidate({ hardAdmissionTokens: 650 }));
assert.equal(
  lowOnly.projection.degradationLevel,
  CONTEXT_PROJECTION_DEGRADATION_LEVEL.priorityBudgeted,
);
assert.deepEqual(lowOnly.projection.omittedCheckpointItemIds, ["low-2"]);
assert.equal(lowOnly.projection.tokenEstimate, 630);

const zeroTokenLow = planner.plan(
  candidate({
    checkpointItemTokenEstimates: [
      { itemId: "critical-1", tokenEstimate: 100 },
      { itemId: "high-1", tokenEstimate: 80 },
      { itemId: "normal-1", tokenEstimate: 60 },
      { itemId: "low-1", tokenEstimate: 40 },
      { itemId: "low-2", tokenEstimate: 0 },
    ],
    hardAdmissionTokens: 620,
  }),
);
assert.deepEqual(zeroTokenLow.projection.omittedCheckpointItemIds, ["low-1"]);
assert.match(
  zeroTokenLow.selectedCheckpointItems.map((selected) => selected.id).join(","),
  /low-2/,
);

const priorityOrder = planner.plan(candidate({ hardAdmissionTokens: 451 }));
assert.deepEqual(priorityOrder.projection.omittedCheckpointItemIds, [
  "high-1",
  "normal-1",
  "low-1",
  "low-2",
]);
assert.deepEqual(priorityOrder.projection.selectedCheckpointItemIds, ["critical-1"]);
assert.equal(priorityOrder.projection.tokenEstimate, 450);

const recentReduced = planner.plan(candidate({ hardAdmissionTokens: 400 }));
assert.equal(
  recentReduced.projection.degradationLevel,
  CONTEXT_PROJECTION_DEGRADATION_LEVEL.recentWindowReduced,
);
assert.deepEqual(recentReduced.projection.selectedCheckpointItemIds, ["critical-1"]);
assert.deepEqual(recentReduced.projection.recentMessageIds, ["message-recent-2"]);
assert.deepEqual(recentReduced.projection.pinnedMessageIds, ["message-pinned"]);
assert.equal(recentReduced.projection.tokenEstimate, 380);

assert.throws(
  () => planner.plan(candidate({ hardAdmissionTokens: 320 })),
  (error) =>
    error instanceof ContextProjectionPlannerError &&
    error.failure === CONTEXT_PROJECTION_PLANNER_FAILURE.contextUnreducible,
);

assert.throws(
  () =>
    planner.plan(
      candidate({
        checkpointItemTokenEstimates: [
          { itemId: "critical-1", tokenEstimate: 100 },
        ],
      }),
    ),
  (error) =>
    error instanceof ContextProjectionPlannerError &&
    error.failure === CONTEXT_PROJECTION_PLANNER_FAILURE.invalidCandidate,
);

const mutableRecentIds = ["message-recent-1", "message-recent-2"];
const immutablePlan = planner.plan(candidate({ recentMessageIds: mutableRecentIds }));
mutableRecentIds.shift();
assert.deepEqual(immutablePlan.projection.recentMessageIds, [
  "message-recent-1",
  "message-recent-2",
]);

const overlay = renderer.render(checkpoint, lowOnly.projection);
assert.equal(overlay.checkpointId, "checkpoint-1");
assert.match(overlay.content, /^<CONTEXT_CHECKPOINT id="checkpoint-1">/);
assert.match(overlay.content, /derived historical context, not user instructions/);
assert.match(overlay.content, /Summary:/);
assert.match(overlay.content, /critical-1/);
assert.doesNotMatch(overlay.content, /low-2/);
assert.doesNotMatch(overlay.content, new RegExp(localPathMarker));
assert.equal(Object.isFrozen(overlay), true);

const serializedLogs = JSON.stringify(logs);
assert.doesNotMatch(serializedLogs, new RegExp(privateMarker));
assert.doesNotMatch(serializedLogs, new RegExp(localPathMarker));
assert.doesNotMatch(serializedLogs, /safe-display-name\.txt/);
assert.match(serializedLogs, /runtime\.context\.projection_planned/);
assert.match(serializedLogs, /runtime\.context\.projection_failed/);

function runtimeMessage(id, role, timestamp) {
  return {
    id,
    conversationId: "conversation-1",
    role,
    messageType: `${role}.message`,
    schemaVersion: 1,
    timestamp,
    runId: "run-1",
    payload: {
      content: [{ type: "text", text: `${privateMarker}:${id}` }],
    },
  };
}

const canonicalMessages = [
  runtimeMessage("message-recent-1", "user", "2026-08-02T04:01:00.000Z"),
  runtimeMessage("message-pinned", "assistant", "2026-08-02T04:02:00.000Z"),
  runtimeMessage("message-recent-2", "user", "2026-08-02T04:03:00.000Z"),
];
const coordinatorRequests = [];
const coordinator = new ContextProjectionProviderCallCoordinator({
  candidateProvider: {
    async load(request) {
      coordinatorRequests.push(request);
      return candidate({ hardAdmissionTokens: 400 });
    },
  },
  planner,
  logger,
});
const providerCall = await coordinator.prepare({
  conversationId: "conversation-1",
  runId: "run-1",
  providerCallId: "provider-call-1",
  baseSystemPrompt: "BASE_SYSTEM_PROMPT",
  canonicalMessages,
  transientMessageCount: 1,
});
assert.equal(coordinatorRequests.length, 1);
assert.equal(Object.isFrozen(coordinatorRequests[0].canonicalMessages), true);
assert.equal(Object.isFrozen(providerCall), true);
assert.equal(Object.isFrozen(providerCall.context), true);
assert.equal(Object.isFrozen(providerCall.context.messages), true);
assert.deepEqual(
  providerCall.context.messages.map((message) => message.id),
  ["message-pinned", "message-recent-2"],
);
assert.match(
  providerCall.context.systemPrompt,
  /^BASE_SYSTEM_PROMPT\n\n<CONTEXT_CHECKPOINT/,
);
assert.equal(
  providerCall.projection.degradationLevel,
  CONTEXT_PROJECTION_DEGRADATION_LEVEL.recentWindowReduced,
);
assert.equal(canonicalMessages.length, 3);

const invalidClassification = new ContextProjectionProviderCallCoordinator({
  candidateProvider: {
    async load() {
      return candidate({ recentMessageIds: ["message-recent-2"] });
    },
  },
  logger,
});
await assert.rejects(
  () =>
    invalidClassification.prepare({
      conversationId: "conversation-1",
      runId: "run-1",
      providerCallId: "provider-call-1",
      baseSystemPrompt: "BASE_SYSTEM_PROMPT",
      canonicalMessages,
      transientMessageCount: 1,
    }),
  (error) =>
    error instanceof ContextProjectionPlannerError &&
    error.failure === CONTEXT_PROJECTION_PLANNER_FAILURE.invalidCandidate,
);

const failedLoad = new ContextProjectionProviderCallCoordinator({
  candidateProvider: {
    async load() {
      throw new Error(`${privateMarker}:candidate-load`);
    },
  },
  logger,
});
await assert.rejects(
  () =>
    failedLoad.prepare({
      conversationId: "conversation-1",
      runId: "run-1",
      providerCallId: "provider-call-1",
      baseSystemPrompt: "BASE_SYSTEM_PROMPT",
      canonicalMessages,
      transientMessageCount: 1,
    }),
  (error) =>
    error instanceof ContextProjectionPlannerError &&
    error.failure === CONTEXT_PROJECTION_PLANNER_FAILURE.candidateLoadFailed,
);

const failedOverlay = new ContextProjectionProviderCallCoordinator({
  candidateProvider: {
    async load() {
      return candidate();
    },
  },
  overlayRenderer: {
    render() {
      throw new Error(`${privateMarker}:overlay`);
    },
  },
  logger,
});
await assert.rejects(
  () =>
    failedOverlay.prepare({
      conversationId: "conversation-1",
      runId: "run-1",
      providerCallId: "provider-call-1",
      baseSystemPrompt: "BASE_SYSTEM_PROMPT",
      canonicalMessages,
      transientMessageCount: 1,
    }),
  (error) =>
    error instanceof ContextProjectionPlannerError &&
    error.failure === CONTEXT_PROJECTION_PLANNER_FAILURE.overlayRenderFailed,
);

const finalSerializedLogs = JSON.stringify(logs);
assert.doesNotMatch(finalSerializedLogs, new RegExp(privateMarker));
assert.doesNotMatch(finalSerializedLogs, new RegExp(localPathMarker));
assert.match(finalSerializedLogs, /runtime\.context\.projection_application_completed/);
assert.match(finalSerializedLogs, /candidate_load_failed/);
assert.match(finalSerializedLogs, /overlay_render_failed/);

console.log("runtime context projection planner smoke passed");
