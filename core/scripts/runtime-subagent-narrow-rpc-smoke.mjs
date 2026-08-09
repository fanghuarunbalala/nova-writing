import assert from "node:assert/strict";
import {
  CONVERSATION_RUNTIME_ACTIVATION_REASON,
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  TaskAssignedInputEvent,
} from "../dist/index.js";
import {
  ChildRuntimeSubagentClient,
  ParentRuntimeSubagentHandler,
} from "../dist/node/index.js";

const timestamp = "2026-08-08T00:00:00.000Z";
// 伪造子会话 journal：最新 run-state 输出事件页。真实 agent.run.state.changed
// 事件 payload.current 为 RunStatus 字符串（非对象），按此形状伪造。
// Fake child journals keyed by conversation; the handler reads the real
// RunStatus string from payload.current onto the terminal observation.
const TERMINAL_EVENT_PAGES = {
  "conversation-child": [
    { direction: "output", timestamp, payload: { current: "completed" } },
  ],
  "conversation-child-failed": [
    { direction: "output", timestamp, payload: { current: "failed" } },
  ],
  "conversation-child-pending": [
    { direction: "output", timestamp, payload: { current: "queued" } },
  ],
};
// 伪造最终 assistant 消息完成事件页：payload.content 含 text 项。
// Fake agent.assistant.message.completed pages with extractable text items.
const FINAL_MESSAGE_EVENT_PAGES = {
  "conversation-child": [
    {
      direction: "output",
      timestamp,
      payload: {
        content: [
          { type: "thinking", thinking: "private" },
          { type: "text", text: "final assistant text" },
        ],
      },
    },
  ],
  "conversation-child-failed": [
    { direction: "output", timestamp, payload: { content: [] } },
  ],
};
const hostCalls = [];
const host = {
  async ensureActive(request) {
    hostCalls.push(["ensureActive", request]);
    return {
      status: "activated",
      presence: { state: "online", observedAt: timestamp },
    };
  },
  async shutdownRuntime(request) {
    hostCalls.push(["shutdownRuntime", request]);
    return {
      status: "stopped",
      presence: { state: "offline", observedAt: timestamp },
    };
  },
};
const commandCalls = [];
const commandService = {
  async enqueue(conversationId, event) {
    commandCalls.push([conversationId, event]);
    return {
      status: "accepted",
      conversationId,
      inputEventId: event.id,
      sequence: 1,
      acceptedAt: timestamp,
    };
  },
};

const journalReader = {
  async list(query) {
    const eventType = query.eventTypes?.[0];
    const events =
      eventType === "agent.run.state.changed"
        ? (TERMINAL_EVENT_PAGES[query.conversationId] ?? [])
        : eventType === "agent.assistant.message.completed"
          ? (FINAL_MESSAGE_EVENT_PAGES[query.conversationId] ?? [])
          : [];
    return { events, highWatermark: events.length, hasPrevious: false, hasNext: false };
  },
};
const handler = new ParentRuntimeSubagentHandler({
  host,
  commandService,
  journalReader,
});
const requester = {
  async request(method, payload, options) {
    return handler.handle(method, payload, {
      sessionId: "session-narrow-rpc",
      requestId: "request-narrow-rpc",
      signal: options?.signal ?? new AbortController().signal,
    });
  },
};
const client = new ChildRuntimeSubagentClient({ requester });

const activated = await client.host.ensureActive({
  conversationId: "conversation-child",
  reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
});
assert.equal(activated.status, "activated");
assert.deepEqual(hostCalls[0][1], {
  conversationId: "conversation-child",
  reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
});

const stopped = await client.host.shutdownRuntime({
  conversationId: "conversation-child",
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
});
assert.equal(stopped.status, "stopped");
assert.deepEqual(hostCalls[1][1], {
  conversationId: "conversation-child",
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
});

const receipt = await client.commandService.enqueue(
  "conversation-child",
  new TaskAssignedInputEvent({
    id: "task-assigned-task-1",
    conversationId: "conversation-child",
    correlationId: "conversation-parent",
    causationId: "task-1",
    taskId: "task-1",
    requesterConversationId: "conversation-parent",
    prompt: "Summarize the outline",
    artifactReferences: [],
  }),
);
assert.equal(receipt.status, "accepted");
assert.equal(receipt.sequence, 1);
const [queuedConversationId, queuedEvent] = commandCalls[0];
assert.equal(queuedConversationId, "conversation-child");
const queuedPayload = queuedEvent.getPayload();
assert.equal(queuedPayload.taskId, "task-1");
assert.equal(queuedPayload.requesterConversationId, "conversation-parent");
assert.equal(queuedPayload.prompt, "Summarize the outline");
assert.deepEqual(queuedPayload.artifactReferences, []);

// 第 4 个只读方法：探测子会话 run 终态。readChildRunTerminal round-trip.
const terminal = await client.readChildRunTerminal("conversation-child");
assert.deepEqual(terminal, { found: true, status: "completed", completedAt: timestamp });
const failedTerminal = await client.readChildRunTerminal("conversation-child-failed");
assert.deepEqual(failedTerminal, { found: true, status: "failed", completedAt: timestamp });
const pendingTerminal = await client.readChildRunTerminal("conversation-child-pending");
assert.deepEqual(pendingTerminal, { found: false });
const unknownTerminal = await client.readChildRunTerminal("conversation-child-unknown");
assert.deepEqual(unknownTerminal, { found: false });

// 第 5 个只读方法：读取子会话最终 assistant 消息正文（跨会话，不能走父绑定 persistence）。
// Round-trip the child final assistant message read.
const finalMessage = await client.readChildFinalAssistantMessage("conversation-child");
assert.deepEqual(finalMessage, { found: true, content: "final assistant text" });
const emptyFinalMessage = await client.readChildFinalAssistantMessage("conversation-child-failed");
assert.deepEqual(emptyFinalMessage, { found: false });
const missingFinalMessage = await client.readChildFinalAssistantMessage("conversation-child-unknown");
assert.deepEqual(missingFinalMessage, { found: false });

// Non-allowlisted RPC methods are rejected at the parent handler boundary.
await assert.rejects(
  handler.handle("journal.list", {}, {
    sessionId: "session-narrow-rpc",
    requestId: "request-denied",
    signal: new AbortController().signal,
  }),
);

console.log("Runtime subagent narrow RPC smoke passed");
