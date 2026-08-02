import assert from "node:assert/strict";
import {
  ApprovalDecisionInputEvent,
  NOVEL_APPROVAL_DECISION_OUTCOME,
  NovelApprovalBridge,
  captureNovelChangeSet,
  captureNovelChangeSetDigest,
  captureNovelDraftSessionId,
  captureNovelEntityVersion,
  captureNovelId,
  captureNovelOperation,
  captureNovelOperationDigest,
  captureNovelOperationId,
  captureNovelOperationVersion,
  captureNovelRevision,
  captureNovelTimestamp,
} from "../dist/index.js";

class RecordingPublisher {
  constructor() { this.snapshots = []; }
  async publish(event) {
    const snapshot = event.getSnapshot();
    this.snapshots.push(snapshot);
    return {
      status: "recorded",
      conversationId: snapshot.conversationId,
      outputEventId: snapshot.id,
      sequence: this.snapshots.length,
      recordedAt: snapshot.timestamp,
    };
  }
}

function createChangeSet({ digestCharacter, baseRevision = "revision-bridge" }) {
  const operation = captureNovelOperation({
    operationId: captureNovelOperationId(`operation-bridge-${digestCharacter}`),
    operationVersion: captureNovelOperationVersion(1),
    type: "character.rename",
    expected: [{
      kind: "entity-version",
      entityType: "character",
      entityId: "character-bridge",
      expectedEntityVersion: captureNovelEntityVersion(1),
    }],
    payload: { name: "FORBIDDEN_BRIDGE_CONTENT" },
  });
  return captureNovelChangeSet({
    changeSetVersion: 1,
    novelId: captureNovelId("novel-approval-bridge"),
    draftSessionId: captureNovelDraftSessionId("draft-approval-bridge"),
    baseRevision: captureNovelRevision(baseRevision),
    operationCount: 1,
    lastOperationSequence: 1,
    operations: [{
      sequence: 1,
      operation,
      operationDigest: captureNovelOperationDigest(
        `sha256:${digestCharacter.repeat(64)}`,
      ),
    }],
    digest: captureNovelChangeSetDigest(`sha256:${digestCharacter.repeat(64)}`),
    frozenAt: captureNovelTimestamp("2026-08-02T16:00:00.000Z"),
  });
}

function decision(request, options = {}) {
  return new ApprovalDecisionInputEvent({
    id: options.id ?? `decision-${request.changeSetDigest.slice(-8)}`,
    conversationId: options.conversationId ?? request.conversationId,
    timestamp: options.timestamp ?? "2026-08-02T16:05:00.000Z",
    approvalRequestId: request.approvalRequestId,
    decision: options.decision ?? "approved",
    argumentDigest: request.changeSetDigest,
  }).getSnapshot();
}

const publisher = new RecordingPublisher();
const grants = [];
const bridge = new NovelApprovalBridge({
  outputPublisher: publisher,
  approvalGranter: {
    async grant(changeSet) { grants.push(changeSet.digest); },
  },
});

const staleSource = createChangeSet({ digestCharacter: "a" });
const staleWaiter = bridge.request(
  staleSource,
  "conversation-approval-bridge",
  captureNovelTimestamp("2026-08-02T16:01:00.000Z"),
);
await Promise.resolve();
await Promise.resolve();
assert.equal((await bridge.listPending()).length, 1);
assert.equal(grants.length, 0);
const staleRequest = (await bridge.listPending())[0];
assert.equal(
  (await bridge.resolve(
    decision(staleRequest, { conversationId: "wrong-conversation" }),
    staleSource,
  )).outcome,
  NOVEL_APPROVAL_DECISION_OUTCOME.identityMismatch,
);
const staleResult = await bridge.resolve(
  decision(staleRequest),
  createChangeSet({ digestCharacter: "a", baseRevision: "revision-changed" }),
);
assert.equal(staleResult.outcome, NOVEL_APPROVAL_DECISION_OUTCOME.staleChangeSet);
assert.equal((await staleWaiter).decision, "stale");
assert.equal(grants.length, 0);

const approvedChangeSet = createChangeSet({ digestCharacter: "b" });
const approvedWaiter = bridge.request(
  approvedChangeSet,
  "conversation-approval-bridge",
  captureNovelTimestamp("2026-08-02T16:02:00.000Z"),
);
await Promise.resolve();
await Promise.resolve();
const approvedRequest = (await bridge.listPending())[0];
const approvedInput = decision(approvedRequest, { id: "decision-approved" });
const approvedResult = await bridge.resolve(approvedInput, approvedChangeSet);
assert.equal(approvedResult.outcome, NOVEL_APPROVAL_DECISION_OUTCOME.resolved);
assert.equal((await approvedWaiter).decision, "approved");
assert.deepEqual(grants, [approvedChangeSet.digest]);
assert.equal(
  (await bridge.resolve(approvedInput, approvedChangeSet)).outcome,
  NOVEL_APPROVAL_DECISION_OUTCOME.duplicate,
);

const rejectedChangeSet = createChangeSet({ digestCharacter: "c" });
const rejectedWaiter = bridge.request(
  rejectedChangeSet,
  "conversation-approval-bridge",
  captureNovelTimestamp("2026-08-02T16:03:00.000Z"),
);
await Promise.resolve();
await Promise.resolve();
const rejectedRequest = (await bridge.listPending())[0];
assert.equal(
  (await bridge.resolve(
    decision(rejectedRequest, { decision: "rejected", id: "decision-rejected" }),
    rejectedChangeSet,
  )).outcome,
  NOVEL_APPROVAL_DECISION_OUTCOME.resolved,
);
assert.equal((await rejectedWaiter).decision, "rejected");
assert.deepEqual(grants, [approvedChangeSet.digest]);
assert.equal(publisher.snapshots.length, 3);
assert.equal(
  JSON.stringify(publisher.snapshots).includes("FORBIDDEN_BRIDGE_CONTENT"),
  false,
);

console.log("novel approval bridge smoke passed");
