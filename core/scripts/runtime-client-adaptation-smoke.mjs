import assert from "node:assert/strict";
import {
  DefaultNovelApiClient,
  UserMessageInputEvent,
} from "../dist/index.js";
import {
  DeterministicMockClock,
  DeterministicMockNovelHost,
  MockElectronApiTransport,
  MockHttpWebSocketApiTransport,
} from "../dist/testing/index.js";

const transportCases = [
  ["electron-gui", MockElectronApiTransport],
  ["http-web-cli-tui", MockHttpWebSocketApiTransport],
];

for (const [clientKind, Transport] of transportCases) {
  const clock = new DeterministicMockClock({
    start: "2026-08-03T05:00:00.000Z",
  });
  const host = new DeterministicMockNovelHost({ clock });
  const conversationId = `conversation-client-${clientKind}`;
  host.registerConversation({
    snapshot: createSnapshot(conversationId),
    runtimePresence: {
      state: "offline",
      observedAt: "2026-08-03T05:00:00.000Z",
    },
  });
  const transport = new Transport({ host });
  const api = new DefaultNovelApiClient({ transport });
  const conversation = await api.conversations.open(conversationId);

  assert.equal((await conversation.getSnapshot()).metadata.id, conversationId);
  assert.equal((await conversation.getRuntimePresence()).state, "offline");
  assert.equal(
    (await conversation.events.list({ anchor: { from: "start" } })).events.length,
    0,
  );

  const events = conversation.events.subscribe({
    start: { from: "start" },
    liveBufferCapacity: 8,
  });
  const input = new UserMessageInputEvent({
    id: `input-${clientKind}`,
    timestamp: "2026-08-03T05:00:01.000Z",
    text: "client parity input",
  });
  const receipt = await conversation.input.enqueue(input);
  assert.equal(receipt.status, "accepted");
  assert.equal((await readEvent(events)).eventType, "user.message");

  await host.appendOutput(createAssistantOutput(conversationId, clientKind));
  assert.equal((await readEvent(events)).direction, "output");
  assert.equal(
    (await conversation.events.list({ anchor: { from: "start" } })).events.length,
    2,
  );

  await events.close();
  await conversation.close();
  await transport.close();
  await host.close();
}

console.log("runtime client adaptation smoke passed");

function createSnapshot(conversationId) {
  return Object.freeze({
    metadata: Object.freeze({
      id: conversationId,
      workspaceId: "workspace-client-adaptation",
      rootConversationId: conversationId,
      status: "active",
      createdAt: "2026-08-03T05:00:00.000Z",
      updatedAt: "2026-08-03T05:00:00.000Z",
      lastJournalSequence: 0,
    }),
    activeAgentBinding: Object.freeze({
      id: `binding-${conversationId}`,
      conversationId,
      revision: 1,
      agentType: "novel_agent",
      definitionVersion: "1.0.0",
      status: "active",
      createdAt: "2026-08-03T05:00:00.000Z",
    }),
  });
}

function createAssistantOutput(conversationId, clientKind) {
  return Object.freeze({
    id: `output-${clientKind}`,
    conversationId,
    eventType: "agent.message",
    schemaVersion: 1,
    timestamp: "2026-08-03T05:00:02.000Z",
    payload: Object.freeze({ part: clientKind }),
  });
}

async function readEvent(subscription) {
  const result = await subscription.next();
  assert.equal(result.done, false);
  return result.value;
}
