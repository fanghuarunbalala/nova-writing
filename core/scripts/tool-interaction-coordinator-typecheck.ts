/** Compile-only proof that approval actors stay outside InputEvent payloads. */
import {
  ApprovalDecisionInputEvent,
  type ToolApprovalInteractionSnapshot,
} from "../src/index.js";

new ApprovalDecisionInputEvent({
  conversationId: "conversation-1",
  approvalRequestId: "approval-1",
  decision: "approved",
  argumentDigest: `sha256:${"a".repeat(64)}`,
});

new ApprovalDecisionInputEvent({
  conversationId: "conversation-1",
  approvalRequestId: "approval-1",
  decision: "approved",
  argumentDigest: `sha256:${"a".repeat(64)}`,
  // @ts-expect-error Approval actors must come from trusted command metadata.
  actorId: "payload_actor",
});

declare const snapshot: ToolApprovalInteractionSnapshot;
// @ts-expect-error Recovery snapshots are immutable.
snapshot.pending.push(snapshot.pending[0]);
