import assert from "node:assert/strict";
import {
  NudgeRuntimeEventBridge,
  OUTPUT_EVENT_TYPE,
} from "../dist/index.js";

const acknowledgements = [];
const conditions = [];
const bridge = new NudgeRuntimeEventBridge({
  acknowledgementPort: {
    acknowledge: async (input) => {
      acknowledgements.push(input);
      return { nudge: {}, source: input.source };
    },
  },
  conditionPort: {
    resolve: async (input) => {
      conditions.push(input);
      return { status: "resolved", nudge: {} };
    },
  },
  policy: {
    review: ({ source, event }) => source === "subagent_terminal"
      ? [{
          kind: "resolve_condition",
          nudgeId: "nudge-subagent",
          targetRunId: event.runId,
          conditionRef: { id: "condition.subagent", version: "1" },
          childConversationId: event.payload.childConversationId,
        }]
      : [{
          kind: "acknowledge",
          nudgeId: `nudge-${source}`,
          targetRunId: event.runId,
          acknowledgementRef: { id: `ack.${source}`, version: "1" },
          reasonId: source,
        }],
  },
});

const base = {
  schemaVersion: 1,
  conversationId: "conversation-parent",
  runId: "run-parent",
  timestamp: "2026-08-03T00:00:00.000Z",
};
const toolReceipt = await bridge.observe({
  ...base,
  id: "event-tool",
  eventType: OUTPUT_EVENT_TYPE.toolTraceRecorded,
  payload: { stage: "execution_completed", toolCallId: "tool-call" },
});
assert.equal(toolReceipt.source, "tool_result");
assert.equal(acknowledgements[0].source, "tool_result");

const approvalReceipt = await bridge.observe({
  ...base,
  id: "event-approval",
  eventType: OUTPUT_EVENT_TYPE.toolApprovalResolved,
  payload: { decision: "approved", approvalRequestId: "approval" },
});
assert.equal(approvalReceipt.source, "approval_decision");
assert.equal(acknowledgements[1].source, "approval_decision");

const subagentReceipt = await bridge.observe({
  ...base,
  id: "event-subagent",
  eventType: OUTPUT_EVENT_TYPE.subagentCompleted,
  payload: { subagentId: "subagent-1", childConversationId: "conversation-child" },
});
assert.equal(subagentReceipt.source, "subagent_terminal");
assert.equal(conditions[0].targetRunId, "run-parent");

assert.equal(await bridge.observe({
  ...base,
  id: "event-progress",
  eventType: OUTPUT_EVENT_TYPE.subagentProgress,
  payload: { subagentId: "subagent-1", childConversationId: "conversation-child" },
}), undefined);

const invalidBridge = new NudgeRuntimeEventBridge({
  acknowledgementPort: { acknowledge: async () => { throw new Error(); } },
  conditionPort: { resolve: async () => ({ status: "not_matched" }) },
  policy: {
    review: ({ event }) => [{
      kind: "resolve_condition",
      nudgeId: "nudge-invalid-child",
      targetRunId: event.runId,
      conditionRef: { id: "condition.invalid", version: "1" },
      childConversationId: "different-child",
    }],
  },
});
await assert.rejects(() => invalidBridge.observe({
  ...base,
  id: "event-invalid-child",
  eventType: OUTPUT_EVENT_TYPE.subagentFailed,
  payload: { subagentId: "subagent-1", childConversationId: "conversation-child" },
}));

console.log("runtime nudge event bridge smoke: passed");
