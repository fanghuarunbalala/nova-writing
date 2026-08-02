import assert from "node:assert/strict";
import {
  ApprovalDecisionInputEvent,
  createCoreEventSchemaRegistry,
  EventValidationError,
  INPUT_EVENT_TYPE,
  OUTPUT_EVENT_TYPE,
  ToolApprovalRequestedOutputEvent,
  ToolApprovalResolvedOutputEvent,
} from "../dist/index.js";

const registry = createCoreEventSchemaRegistry();
const digest = `sha256:${"a".repeat(64)}`;
const decision = new ApprovalDecisionInputEvent({
  id: "input-approval-1",
  conversationId: "conversation-approval",
  runId: "run-approval",
  timestamp: "2026-08-02T01:00:00.000Z",
  approvalRequestId: "approval-1",
  decision: "approved",
  argumentDigest: digest,
  actorId: "untrusted-payload-actor",
});
const decisionSnapshot = decision.getSnapshot();
assert.equal(decisionSnapshot.eventType, INPUT_EVENT_TYPE.approvalDecision);
assert.equal(decisionSnapshot.priority, 900);
assert.deepEqual(decisionSnapshot.payload, {
  approvalRequestId: "approval-1",
  decision: "approved",
  argumentDigest: digest,
});
assert.equal("actorId" in decisionSnapshot.payload, false);
assert.deepEqual(registry.validateInput(decisionSnapshot), decisionSnapshot);

const requested = new ToolApprovalRequestedOutputEvent({
  id: "output-approval-requested-1",
  conversationId: "conversation-approval",
  runId: "run-approval",
  turnId: "turn-approval",
  approvalRequestId: "approval-1",
  toolCallId: "tool-call-1",
  toolName: "write_file",
  toolVersion: "1.0.0",
  argumentDigest: digest,
  summary: {
    title: "Modify the current draft",
    description: "Writes a bounded redacted change.",
  },
  requestedAt: "2026-08-02T01:00:01.000Z",
  expiresAt: "2026-08-02T01:05:01.000Z",
});
const requestedSnapshot = requested.getSnapshot();
assert.equal(requestedSnapshot.eventType, OUTPUT_EVENT_TYPE.toolApprovalRequested);
assert.deepEqual(registry.validateOutput(requestedSnapshot), requestedSnapshot);

const resolved = new ToolApprovalResolvedOutputEvent({
  id: "output-approval-resolved-1",
  conversationId: "conversation-approval",
  runId: "run-approval",
  turnId: "turn-approval",
  causationId: "input-approval-1",
  approvalRequestId: "approval-1",
  toolCallId: "tool-call-1",
  toolName: "write_file",
  toolVersion: "1.0.0",
  argumentDigest: digest,
  decision: "approved",
  actorId: "local_user",
  resolvedAt: "2026-08-02T01:00:02.000Z",
});
const resolvedSnapshot = resolved.getSnapshot();
assert.equal(resolvedSnapshot.eventType, OUTPUT_EVENT_TYPE.toolApprovalResolved);
assert.deepEqual(registry.validateOutput(resolvedSnapshot), resolvedSnapshot);

assert.throws(
  () => registry.validateInput({
    ...decisionSnapshot,
    payload: { ...decisionSnapshot.payload, actorId: "payload_actor" },
  }),
  EventValidationError,
);
assert.throws(
  () => registry.validateOutput({
    ...requestedSnapshot,
    payload: { ...requestedSnapshot.payload, arguments: { path: "secret" } },
  }),
  EventValidationError,
);
assert.throws(
  () => new ToolApprovalResolvedOutputEvent({
    ...resolvedSnapshot,
    ...resolvedSnapshot.payload,
    decision: "approved",
    actorId: undefined,
  }),
  TypeError,
);

console.log("tool approval events smoke passed");
