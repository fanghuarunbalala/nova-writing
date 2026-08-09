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

const handler = new ParentRuntimeSubagentHandler({ host, commandService });
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

// Non-allowlisted RPC methods are rejected at the parent handler boundary.
await assert.rejects(
  handler.handle("journal.list", {}, {
    sessionId: "session-narrow-rpc",
    requestId: "request-denied",
    signal: new AbortController().signal,
  }),
);

console.log("Runtime subagent narrow RPC smoke passed");
