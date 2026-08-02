import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CONTEXT_BUDGET_DEFAULTS,
  CONTEXT_CHECKPOINT_SCHEMA_VERSION,
  CONTEXT_CHECKPOINT_STORE_FAILURE,
  CONTEXT_COMPACTION_ATTEMPT_FAILURE,
  CONTEXT_COMPACTION_ATTEMPT_STATUS,
  CONTEXT_COMPACTION_EFFECT_TRIGGER,
  CONTEXT_COMPACTION_MANAGER_DISPOSITION,
  CONTEXT_COMPACTION_MANAGER_FAILURE,
  CONTEXT_COMPACTION_OUTCOME,
  CONTEXT_PIN_GROUP_KIND,
  CONTEXT_PIN_LIFETIME,
  CONTEXT_PRESSURE_LEVEL,
  ContextCheckpointStoreError,
  ContextCompactionManager,
  ContextCompactionManagerError,
  InMemoryContextCheckpointStore,
} from "../dist/index.js";

const privateMarker = "PRIVATE_COMPACTION_CONTENT_MUST_NOT_APPEAR";
const logs = [];
const logger = {
  debug: (event, fields) => logs.push({ level: "debug", event, fields }),
  info: (event, fields) => logs.push({ level: "info", event, fields }),
  warn: (event, fields) => logs.push({ level: "warn", event, fields }),
  error: (event, fields) => logs.push({ level: "error", event, fields }),
  child: () => logger,
};

const hasher = {
  algorithm: "sha256",
  async digest(canonicalContent) {
    return `sha256:${createHash("sha256").update(canonicalContent).digest("hex")}`;
  },
};

let clockTick = 0;
const clock = {
  now() {
    const timestamp = new Date(
      Date.parse("2026-08-02T03:00:00.000Z") + clockTick,
    ).toISOString();
    clockTick += 1;
    return timestamp;
  },
};

let checkpointNumber = 0;
const checkpointIdFactory = {
  create() {
    checkpointNumber += 1;
    return `checkpoint-${checkpointNumber}`;
  },
};

function effect(
  providerCallId,
  evaluatedAt,
  { totalTokens = 95_000, floorTokens = 30_000 } = {},
) {
  const thresholds = { ...CONTEXT_BUDGET_DEFAULTS };
  const baseSystemPromptTokens = 10_000;
  const toolSchemaTokens = 10_000;
  const pinnedMessageTokens = 5_000;
  const currentInputTokens = 5_000;
  const transientMessageTokens = floorTokens - 30_000;
  const recentMessageTokens = totalTokens - floorTokens;
  return {
    kind: "context_compaction",
    policyId: "context_pressure",
    trigger: CONTEXT_COMPACTION_EFFECT_TRIGGER.hardAdmissionRisk,
    conversationId: "conversation-1",
    runId: "run-1",
    providerCallId,
    requestedAt: evaluatedAt,
    pressure: {
      conversationId: "conversation-1",
      runId: "run-1",
      providerCallId,
      evaluatedAt,
      budget: {
        providerContextWindowTokens: 120_000,
        reservedOutputTokens: 10_000,
        protocolOverheadTokens: 5_000,
        safetyReserveTokens: 5_000,
        effectiveInputTokens: 100_000,
        thresholds,
      },
      estimate: {
        baseSystemPromptTokens,
        toolSchemaTokens,
        checkpointOverlayTokens: 0,
        nudgeReserveTokens: 0,
        pinnedMessageTokens,
        currentInputTokens,
        recentMessageTokens,
        transientMessageTokens,
        totalInputTokens: totalTokens,
      },
      irreducibleFloor: {
        baseSystemPromptTokens,
        toolSchemaTokens,
        pinnedMessageTokens,
        currentInputTokens,
        transientMessageTokens,
        totalTokens: floorTokens,
      },
      usageRatio: totalTokens / 100_000,
      level:
        totalTokens >= 92_000
          ? CONTEXT_PRESSURE_LEVEL.hard
          : CONTEXT_PRESSURE_LEVEL.compaction,
    },
    targetTokens: 55_000,
    compactionRequestTokens: 82_000,
    hardAdmissionTokens: 92_000,
    minimumSavingsTokens: 5_000,
    automaticHysteresisTokens: 10_000,
  };
}

function runtimeMessage(id, role, sequence) {
  const assistant = role === "assistant";
  return {
    sequence,
    ordinal: 0,
    message: {
      id,
      conversationId: "conversation-1",
      role,
      messageType: assistant ? "assistant.message" : "user.message",
      schemaVersion: 1,
      timestamp: new Date(
        Date.parse("2026-08-02T02:00:00.000Z") + sequence,
      ).toISOString(),
      runId: "run-1",
      turnId: `turn-${sequence}`,
      payload: {
        content: [
          {
            type: "text",
            text: `${privateMarker}:${id}`,
          },
        ],
      },
    },
  };
}

const pinnedGroups = [
  {
    id: "pin-current-input",
    conversationId: "conversation-1",
    kind: CONTEXT_PIN_GROUP_KIND.currentInput,
    lifetime: CONTEXT_PIN_LIFETIME.sliding,
    messageIds: ["message-pinned"],
    tokenEstimate: 5_000,
    runId: "run-1",
    turnId: "turn-current",
  },
];

let pendingMessages = [
  runtimeMessage("message-1", "user", 1),
  runtimeMessage("message-2", "assistant", 2),
];
const sourceProvider = {
  async load({ activeCheckpoint }) {
    if (activeCheckpoint === undefined) {
      return {
        conversationId: "conversation-1",
        sourceStartSequence: pendingMessages[0].sequence,
        sourceEndSequence: pendingMessages[pendingMessages.length - 1].sequence,
        messages: pendingMessages,
        pinnedGroups,
      };
    }
    return {
      conversationId: "conversation-1",
      sourceStartSequence: activeCheckpoint.sourceStartSequence,
      sourceEndSequence:
        pendingMessages.length === 0
          ? activeCheckpoint.coveredThroughSequence
          : pendingMessages[pendingMessages.length - 1].sequence,
      messages: pendingMessages,
      pinnedGroups,
    };
  },
};

let compactorMode = "success";
let compactorCalls = 0;
let semanticMode = "accept";
let semanticCalls = 0;
let lastCompactorResult;
const compactor = {
  id: "structured-compactor",
  version: "1",
  async compact(request) {
    compactorCalls += 1;
    assert.equal(Object.isFrozen(request.effect), true);
    assert.equal(Object.isFrozen(request.source), true);
    assert.equal(Object.isFrozen(request.source.messages), true);
    if (compactorMode === "throw") throw new Error(privateMarker);
    const newestMessage = request.source.messages.at(-1)?.message.id ?? "message-2";
    lastCompactorResult = {
      summary: `${privateMarker}:summary:${compactorCalls}`,
      facts: [
        {
          id: `fact-${compactorCalls}`,
          text: `${privateMarker}:fact:${compactorCalls}`,
          priority: "high",
          sourceMessageIds: [newestMessage],
          artifactReferences: [],
        },
      ],
      decisions: [],
      constraints: [],
      unresolvedTasks: [],
      pinnedMessageIds:
        compactorMode === "invalid_pins" ? [] : ["message-pinned"],
      recentWindowStartSequence: request.source.sourceEndSequence + 1,
      tokenEstimateAfter: compactorMode === "unreducible" ? 95_000 : 50_000,
    };
    return lastCompactorResult;
  },
};

const semanticValidator = {
  async validate(request) {
    semanticCalls += 1;
    assert.equal(request.checkpoint.summary.includes(privateMarker), true);
    if (semanticMode === "reject") throw new Error(privateMarker);
  },
};

const store = new InMemoryContextCheckpointStore({ logger });
const manager = new ContextCompactionManager({
  conversationId: "conversation-1",
  store,
  sourceProvider,
  compactor,
  hasher,
  semanticValidator,
  checkpointIdFactory,
  clock,
  logger,
});

const firstEffect = effect("provider-call-1", "2026-08-02T02:30:00.000Z");
const first = await manager.compact(firstEffect);
assert.equal(first.disposition, CONTEXT_COMPACTION_MANAGER_DISPOSITION.activated);
assert.equal(first.assessment.outcome, CONTEXT_COMPACTION_OUTCOME.targetMet);
assert.equal(first.checkpoint.id, "checkpoint-1");
assert.equal(first.checkpoint.parentCheckpointId, undefined);
assert.equal(first.checkpoint.sourceStartSequence, 1);
assert.equal(first.checkpoint.coveredThroughSequence, 2);
assert.equal(first.checkpoint.pinnedMessageIds[0], "message-pinned");
assert.match(first.checkpoint.sourceDigest, /^sha256:[0-9a-f]{64}$/);
assert.match(first.checkpoint.contentDigest, /^sha256:[0-9a-f]{64}$/);
assert.notEqual(first.checkpoint.sourceDigest, first.checkpoint.contentDigest);
assert.equal(Object.isFrozen(first.checkpoint), true);
assert.equal(Object.isFrozen(first.checkpoint.facts), true);
lastCompactorResult.summary = "mutated summary";
lastCompactorResult.facts[0].text = "mutated fact";
assert.equal(first.checkpoint.summary.includes(privateMarker), true);
assert.equal(first.checkpoint.facts[0].text.includes(privateMarker), true);
assert.equal((await store.getActive("conversation-1")).id, "checkpoint-1");
assert.equal(compactorCalls, 1);
assert.equal(semanticCalls, 1);

pendingMessages = [];
const duplicate = await manager.compact(
  effect("provider-call-2", "2026-08-02T02:31:00.000Z"),
);
assert.equal(
  duplicate.disposition,
  CONTEXT_COMPACTION_MANAGER_DISPOSITION.duplicate,
);
assert.equal(duplicate.attempt.status, CONTEXT_COMPACTION_ATTEMPT_STATUS.completed);
assert.equal(compactorCalls, 1);

pendingMessages = [runtimeMessage("message-3", "user", 3)];
const second = await manager.compact(
  effect("provider-call-3", "2026-08-02T02:32:00.000Z"),
);
assert.equal(second.disposition, CONTEXT_COMPACTION_MANAGER_DISPOSITION.activated);
assert.equal(second.checkpoint.id, "checkpoint-2");
assert.equal(second.checkpoint.parentCheckpointId, "checkpoint-1");
assert.equal(second.checkpoint.sourceStartSequence, 1);
assert.equal(second.checkpoint.coveredThroughSequence, 3);
assert.equal((await store.getActive("conversation-1")).id, "checkpoint-2");
assert.equal(compactorCalls, 2);

pendingMessages = [runtimeMessage("message-4", "assistant", 4)];
compactorMode = "throw";
await assert.rejects(
  manager.compact(effect("provider-call-4", "2026-08-02T02:33:00.000Z")),
  (error) =>
    error instanceof ContextCompactionManagerError &&
    error.failure === CONTEXT_COMPACTION_MANAGER_FAILURE.compactorFailed &&
    error.message.includes(privateMarker) === false,
);
assert.equal((await store.getActive("conversation-1")).id, "checkpoint-2");
assert.equal(compactorCalls, 3);
const failedDuplicate = await manager.compact(
  effect("provider-call-5", "2026-08-02T02:34:00.000Z"),
);
assert.equal(
  failedDuplicate.disposition,
  CONTEXT_COMPACTION_MANAGER_DISPOSITION.duplicate,
);
assert.equal(failedDuplicate.attempt.status, CONTEXT_COMPACTION_ATTEMPT_STATUS.failed);
assert.equal(
  failedDuplicate.attempt.failure,
  CONTEXT_COMPACTION_ATTEMPT_FAILURE.compactorFailed,
);
assert.equal(compactorCalls, 3);

pendingMessages = [runtimeMessage("message-5", "user", 5)];
compactorMode = "unreducible";
const unreducible = await manager.compact(
  effect("provider-call-6", "2026-08-02T02:35:00.000Z"),
);
assert.equal(
  unreducible.disposition,
  CONTEXT_COMPACTION_MANAGER_DISPOSITION.unreducible,
);
assert.equal(unreducible.assessment.outcome, CONTEXT_COMPACTION_OUTCOME.unreducible);
assert.equal(unreducible.checkpoint, undefined);
assert.equal((await store.getActive("conversation-1")).id, "checkpoint-2");
assert.equal(compactorCalls, 4);

pendingMessages = [runtimeMessage("message-6", "assistant", 6)];
compactorMode = "invalid_pins";
await assert.rejects(
  manager.compact(effect("provider-call-7", "2026-08-02T02:36:00.000Z")),
  (error) =>
    error instanceof ContextCompactionManagerError &&
    error.failure === CONTEXT_COMPACTION_MANAGER_FAILURE.resultInvalid,
);
assert.equal((await store.getActive("conversation-1")).id, "checkpoint-2");
assert.equal(compactorCalls, 5);

pendingMessages = [runtimeMessage("message-7", "assistant", 7)];
compactorMode = "success";
semanticMode = "reject";
await assert.rejects(
  manager.compact(effect("provider-call-8", "2026-08-02T02:37:00.000Z")),
  (error) =>
    error instanceof ContextCompactionManagerError &&
    error.failure ===
      CONTEXT_COMPACTION_MANAGER_FAILURE.semanticValidationFailed &&
    error.message.includes(privateMarker) === false,
);
assert.equal((await store.getActive("conversation-1")).id, "checkpoint-2");
assert.equal(compactorCalls, 6);

pendingMessages = [runtimeMessage("message-8", "user", 8)];
semanticMode = "accept";
const preflightCompactorCalls = compactorCalls;
const irreducibleFloor = await manager.compact(
  effect("provider-call-9", "2026-08-02T02:38:00.000Z", {
    floorTokens: 92_000,
  }),
);
assert.equal(
  irreducibleFloor.disposition,
  CONTEXT_COMPACTION_MANAGER_DISPOSITION.unreducible,
);
assert.equal(compactorCalls, preflightCompactorCalls);
assert.equal((await store.getActive("conversation-1")).id, "checkpoint-2");

const conflictStore = new InMemoryContextCheckpointStore({ logger });
const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const identityA = {
  conversationId: "conversation-conflict",
  sourceDigest: digestA,
  compactorId: "compactor",
  compactorVersion: "1",
};
const identityB = { ...identityA, sourceDigest: digestB };
await conflictStore.reserveAttempt({
  identity: identityA,
  runId: "run-conflict",
  providerCallId: "call-a",
  requestedAt: "2026-08-02T04:00:00.000Z",
});
await conflictStore.reserveAttempt({
  identity: identityB,
  runId: "run-conflict",
  providerCallId: "call-b",
  requestedAt: "2026-08-02T04:00:01.000Z",
});

function checkpoint(id, sourceDigest) {
  return {
    schemaVersion: CONTEXT_CHECKPOINT_SCHEMA_VERSION,
    id,
    conversationId: "conversation-conflict",
    sourceStartSequence: 1,
    sourceEndSequence: 2,
    coveredThroughSequence: 2,
    sourceDigest,
    summary: "private conflict summary",
    facts: [],
    decisions: [],
    constraints: [],
    unresolvedTasks: [],
    pinnedMessageIds: [],
    recentWindowStartSequence: 3,
    tokenEstimateBefore: 95_000,
    tokenEstimateAfter: 50_000,
    compactorId: "compactor",
    compactorVersion: "1",
    createdAt: "2026-08-02T04:00:02.000Z",
    contentDigest: `sha256:${"c".repeat(64)}`,
  };
}

function assessment(checkpointId) {
  return {
    conversationId: "conversation-conflict",
    runId: "run-conflict",
    providerCallId: checkpointId === "checkpoint-a" ? "call-a" : "call-b",
    outcome: CONTEXT_COMPACTION_OUTCOME.targetMet,
    tokenEstimateBefore: 95_000,
    tokenEstimateAfter: 50_000,
    irreducibleFloorTokens: 30_000,
    targetTokens: 55_000,
    compactionRequestTokens: 82_000,
    hardAdmissionTokens: 92_000,
    minimumSavingsTokens: 5_000,
    targetAchieved: true,
    meaningfulReduction: true,
    checkpointId,
    completedAt: "2026-08-02T04:00:03.000Z",
  };
}

await conflictStore.finalizeAttempt({
  identity: identityA,
  assessment: assessment("checkpoint-a"),
  checkpoint: checkpoint("checkpoint-a", digestA),
});
await assert.rejects(
  conflictStore.finalizeAttempt({
    identity: identityB,
    assessment: assessment("checkpoint-b"),
    checkpoint: checkpoint("checkpoint-b", digestB),
  }),
  (error) =>
    error instanceof ContextCheckpointStoreError &&
    error.failure === CONTEXT_CHECKPOINT_STORE_FAILURE.activationConflict,
);
assert.equal(
  (await conflictStore.getActive("conversation-conflict")).id,
  "checkpoint-a",
);

await manager.drain();
const serializedLogs = JSON.stringify(logs);
assert.equal(serializedLogs.includes(privateMarker), false);
assert.equal(serializedLogs.includes("mutated summary"), false);
assert.equal(serializedLogs.includes("stack"), false);
assert.equal(serializedLogs.includes("cause"), false);

console.log("runtime context compaction manager smoke passed");
