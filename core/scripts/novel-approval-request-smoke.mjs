import assert from "node:assert/strict";
import {
  ApprovalDecisionInputEvent,
  NOVEL_APPROVAL_REQUEST_VERSION,
  NovelApprovalRequestedOutputEvent,
  NovelProtocolValidationError,
  captureNovelApprovalRequest,
  captureNovelChangeSetDigest,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelOperationId,
  captureNovelRevision,
  captureNovelTimestamp,
  coreEventSchemaRegistry,
  createNovelApprovalRequest,
} from "../dist/index.js";

const changeSetDigest = captureNovelChangeSetDigest(
  `sha256:${"a".repeat(64)}`,
);
const changeSet = {
  novelId: captureNovelId("novel-approval-request"),
  draftSessionId: captureNovelDraftSessionId("draft-approval-request"),
  baseRevision: captureNovelRevision("revision-approval-request"),
  digest: changeSetDigest,
  operations: [
    {
      operation: {
        operationId: captureNovelOperationId("operation-approval-request"),
        payload: { text: "FORBIDDEN_OPERATION_PAYLOAD" },
      },
    },
  ],
};
const requestedAt = captureNovelTimestamp("2026-08-02T15:00:00.000Z");
const request = createNovelApprovalRequest(
  changeSet,
  "conversation-approval-request",
  requestedAt,
);
const retry = createNovelApprovalRequest(
  changeSet,
  "conversation-approval-request",
  captureNovelTimestamp("2026-08-02T15:01:00.000Z"),
);

assert.equal(request.requestVersion, NOVEL_APPROVAL_REQUEST_VERSION);
assert.equal(request.approvalRequestId, retry.approvalRequestId);
assert.equal(request.operationIds.length, 1);
assert.equal(Object.isFrozen(request.operationIds), true);

const output = new NovelApprovalRequestedOutputEvent(request);
const snapshot = output.getSnapshot();
assert.equal(snapshot.id, request.approvalRequestId);
assert.equal(snapshot.eventType, "novel.approval.requested");
assert.equal(snapshot.conversationId, request.conversationId);
assert.equal(snapshot.timestamp, request.requestedAt);
assert.equal(snapshot.payload.changeSetDigest, changeSetDigest);
assert.deepEqual(coreEventSchemaRegistry.validateOutput(snapshot), snapshot);
assert.equal(JSON.stringify(snapshot).includes("FORBIDDEN_OPERATION_PAYLOAD"), false);
assert.equal(Object.hasOwn(snapshot.payload, "requestedAt"), false);

const decision = new ApprovalDecisionInputEvent({
  conversationId: request.conversationId,
  approvalRequestId: request.approvalRequestId,
  decision: "approved",
  argumentDigest: request.changeSetDigest,
});
const decisionSnapshot = decision.getSnapshot();
assert.equal(decisionSnapshot.payload.approvalRequestId, request.approvalRequestId);
assert.equal(decisionSnapshot.payload.argumentDigest, request.changeSetDigest);
assert.deepEqual(
  coreEventSchemaRegistry.validateInput(decisionSnapshot),
  decisionSnapshot,
);

assert.throws(
  () =>
    captureNovelApprovalRequest({
      ...request,
      changeSetDigest: captureNovelChangeSetDigest(`sha256:${"b".repeat(64)}`),
    }),
  NovelProtocolValidationError,
);
assert.throws(
  () =>
    coreEventSchemaRegistry.validateOutput({
      ...snapshot,
      payload: { ...snapshot.payload, text: "forbidden" },
    }),
);

console.log("novel approval request smoke passed");
