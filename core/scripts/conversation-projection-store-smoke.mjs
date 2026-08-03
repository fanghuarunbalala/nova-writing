import assert from "node:assert/strict";
import {
  AgentAssistantMessageCompletedOutputEvent,
  AgentAssistantMessageDeltaOutputEvent,
  AgentAssistantMessageStartedOutputEvent,
  AgentRunStateChangedOutputEvent,
  AgentTurnStateChangedOutputEvent,
  ConversationProjectionConversationMismatchError,
  ConversationProjectionEventIdentityConflictError,
  ConversationProjectionSequenceConflictError,
  ConversationProjectionSequenceGapError,
  ConversationProjectionStore,
  DefaultNovelApiClient,
  RuntimePresenceChangedOutputEvent,
  ToolApprovalRequestedOutputEvent,
  ToolApprovalResolvedOutputEvent,
  UserMessageInputEvent,
} from "../dist/index.js";
import {
  DeterministicMockClock,
  DeterministicMockNovelHost,
  MockElectronApiTransport,
  MockHttpWebSocketApiTransport,
  MockTransportFaultController,
} from "../dist/testing/index.js";

const transportCases = [
  ["electron", MockElectronApiTransport],
  ["http-websocket", MockHttpWebSocketApiTransport],
];

for (const [name, Transport] of transportCases) {
  await runProjectionContract(name, Transport);
}

console.log("conversation projection store smoke passed");

async function runProjectionContract(name, Transport) {
  const logs = [];
  const logger = createCollectingLogger(logs);
  const host = new DeterministicMockNovelHost({
    clock: new DeterministicMockClock({
      start: "2026-08-02T04:00:00.000Z",
    }),
    logger,
  });
  const conversationId = `conversation-projection-${name}`;
  host.registerConversation({ snapshot: createSnapshot(conversationId) });
  const faults = new MockTransportFaultController();
  const transport = new Transport({ host, faultController: faults, logger });
  const api = new DefaultNovelApiClient({ transport, logger });
  const conversation = await api.conversations.open(conversationId);
  const subscription = conversation.events.subscribe({
    start: { from: "start" },
  });
  const store = new ConversationProjectionStore({ conversationId, logger });
  let notificationCount = 0;
  store.subscribe(() => {
    notificationCount += 1;
  });

  const secretText = `private-projection-${name}`;
  const input = new UserMessageInputEvent({
    id: `evt-${name}-projection-user`,
    timestamp: "2026-08-02T04:00:01.000Z",
    text: secretText,
  });
  await conversation.input.enqueue(input);
  applyNext(store, await readEvent(subscription));

  const runId = `run-${name}-projection`;
  const turnId = `turn-${name}-projection`;
  const assistantMessageId = `assistant-${name}-projection`;
  await appendOutput(
    host,
    new AgentRunStateChangedOutputEvent({
      id: `evt-${name}-run`,
      conversationId,
      runId,
      inputEvent: {
        id: input.id,
        eventType: input.getEventType(),
        sequence: 1,
      },
      previous: null,
      current: "queued",
      reason: "input_queued",
      timestamp: "2026-08-02T04:00:02.000Z",
    }),
  );
  applyNext(store, await readEvent(subscription));

  await appendOutput(
    host,
    new AgentTurnStateChangedOutputEvent({
      id: `evt-${name}-turn`,
      conversationId,
      runId,
      turnId,
      previous: null,
      current: "running",
      reason: "provider_started",
      timestamp: "2026-08-02T04:00:03.000Z",
    }),
  );
  applyNext(store, await readEvent(subscription));

  await appendOutput(
    host,
    new AgentAssistantMessageStartedOutputEvent({
      id: `evt-${name}-assistant-started`,
      conversationId,
      runId,
      turnId,
      assistantMessageId,
      timestamp: "2026-08-02T04:00:04.000Z",
    }),
  );
  applyNext(store, await readEvent(subscription));

  await appendOutput(
    host,
    new AgentAssistantMessageDeltaOutputEvent({
      id: `evt-${name}-assistant-delta-1`,
      conversationId,
      runId,
      turnId,
      assistantMessageId,
      deltaOrdinal: 0,
      contentIndex: 0,
      channel: "text",
      delta: "Hello ",
      timestamp: "2026-08-02T04:00:05.000Z",
    }),
  );
  applyNext(store, await readEvent(subscription));

  await appendOutput(
    host,
    new AgentAssistantMessageDeltaOutputEvent({
      id: `evt-${name}-assistant-delta-2`,
      conversationId,
      runId,
      turnId,
      assistantMessageId,
      deltaOrdinal: 1,
      contentIndex: 0,
      channel: "text",
      delta: "world",
      timestamp: "2026-08-02T04:00:06.000Z",
    }),
  );
  applyNext(store, await readEvent(subscription));

  await appendOutput(
    host,
    new AgentAssistantMessageCompletedOutputEvent({
      id: `evt-${name}-assistant-completed`,
      conversationId,
      runId,
      turnId,
      assistantMessageId,
      content: [{ type: "text", text: "Hello world" }],
      completionReason: "stop",
      hasToolCalls: false,
      timestamp: "2026-08-02T04:00:07.000Z",
    }),
  );
  applyNext(store, await readEvent(subscription));

  faults.duplicateNextEventDelivery();
  await appendOutput(
    host,
    new RuntimePresenceChangedOutputEvent({
      id: `evt-${name}-runtime-presence`,
      conversationId,
      previous: {
        state: "starting",
        observedAt: "2026-08-02T04:00:07.500Z",
      },
      current: {
        state: "online",
        observedAt: "2026-08-02T04:00:08.000Z",
      },
      reason: "activation_succeeded",
    }),
  );
  const runtimeEvent = await readEvent(subscription);
  assert.equal(store.apply(runtimeEvent), "applied");
  assert.equal(store.apply(await readEvent(subscription)), "duplicate");

  const argumentDigest = `sha256:${"0".repeat(64)}`;
  const approvalRequestId = `approval-${name}-projection`;
  const toolCallId = `tool-call-${name}-projection`;
  await appendOutput(
    host,
    new ToolApprovalRequestedOutputEvent({
      id: `evt-${name}-approval-requested`,
      conversationId,
      runId,
      approvalRequestId,
      toolCallId,
      toolName: "WriteFile",
      toolVersion: "1.0.0",
      argumentDigest,
      summary: {
        title: "Write manuscript file",
        description: "Review one proposed file write",
      },
      requestedAt: "2026-08-02T04:00:09.000Z",
      expiresAt: "2026-08-02T04:10:09.000Z",
    }),
  );
  applyNext(store, await readEvent(subscription));

  await appendOutput(
    host,
    new ToolApprovalResolvedOutputEvent({
      id: `evt-${name}-approval-resolved`,
      conversationId,
      runId,
      approvalRequestId,
      toolCallId,
      toolName: "WriteFile",
      toolVersion: "1.0.0",
      argumentDigest,
      decision: "approved",
      actorId: "actor-user",
      resolvedAt: "2026-08-02T04:00:10.000Z",
    }),
  );
  applyNext(store, await readEvent(subscription));

  await host.appendOutput({
    id: `evt-${name}-unknown`,
    conversationId,
    eventType: "novel.proposal.available",
    schemaVersion: 1,
    timestamp: "2026-08-02T04:00:11.000Z",
    payload: { proposalId: `proposal-${name}` },
  });
  applyNext(store, await readEvent(subscription));

  const projected = store.getSnapshot();
  assert.equal(projected.lastAppliedSequence, 11);
  assert.equal(projected.revision, 11);
  assert.equal(notificationCount, 11);
  assert.equal(projected.events.length, 11);
  assert.equal(projected.timeline.length, 3);
  assert.equal(projected.userMessages[0].text, secretText);
  assert.deepEqual(projected.assistantMessages[0].content, [
    { type: "text", text: "Hello world" },
  ]);
  assert.equal(projected.assistantMessages[0].status, "completed");
  assert.equal(projected.runs[0].current, "queued");
  assert.equal(projected.turns[0].current, "running");
  assert.equal(projected.runtimePresence.state, "online");
  assert.equal(projected.approvals[0].status, "approved");
  assert.equal(projected.approvals[0].actorId, "actor-user");
  assert.equal(
    projected.events.at(-1).eventType,
    "novel.proposal.available",
  );
  assert.equal(JSON.stringify(logs).includes(secretText), false);

  const page = await conversation.events.list({ anchor: { from: "start" } });
  const rebuilt = new ConversationProjectionStore({ conversationId });
  assert.deepEqual(rebuilt.applyMany(page.events), Array(11).fill("applied"));
  assert.deepEqual(rebuilt.getSnapshot(), projected);
  assertProjectionFailures(conversationId, page.events);

  await conversation.close();
  await transport.close();
  await host.close();
}

function assertProjectionFailures(conversationId, events) {
  const gapStore = new ConversationProjectionStore({ conversationId });
  assert.throws(
    () => gapStore.apply(events[1]),
    ConversationProjectionSequenceGapError,
  );

  const conflictStore = new ConversationProjectionStore({ conversationId });
  conflictStore.apply(events[0]);
  assert.throws(
    () =>
      conflictStore.apply({
        ...events[0],
        payload: { text: "changed" },
      }),
    ConversationProjectionSequenceConflictError,
  );

  assert.throws(
    () =>
      conflictStore.apply({
        ...events[1],
        id: events[0].id,
      }),
    ConversationProjectionEventIdentityConflictError,
  );

  const mismatchStore = new ConversationProjectionStore({
    conversationId: "another-conversation",
  });
  assert.throws(
    () => mismatchStore.apply(events[0]),
    ConversationProjectionConversationMismatchError,
  );
}

async function appendOutput(host, event) {
  await host.appendOutput(event.getSnapshot());
}

function applyNext(store, event) {
  assert.equal(store.apply(event), "applied");
}

async function readEvent(subscription) {
  const result = await subscription.next();
  assert.equal(result.done, false);
  return result.value;
}

function createSnapshot(conversationId) {
  return Object.freeze({
    metadata: Object.freeze({
      id: conversationId,
      workspaceId: "workspace-projection",
      rootConversationId: conversationId,
      status: "active",
      createdAt: "2026-08-02T04:00:00.000Z",
      updatedAt: "2026-08-02T04:00:00.000Z",
      lastJournalSequence: 0,
    }),
    activeAgentBinding: Object.freeze({
      id: `binding-${conversationId}`,
      conversationId,
      revision: 1,
      agentType: "novel.main",
      definitionVersion: "1",
      status: "active",
      createdAt: "2026-08-02T04:00:00.000Z",
    }),
  });
}

function createCollectingLogger(entries) {
  return {
    debug: (event, fields) => entries.push({ level: "debug", event, fields }),
    info: (event, fields) => entries.push({ level: "info", event, fields }),
    warn: (event, fields) => entries.push({ level: "warn", event, fields }),
    error: (event, fields) => entries.push({ level: "error", event, fields }),
    child() {
      return this;
    },
  };
}
