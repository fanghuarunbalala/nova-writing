import assert from "node:assert/strict";
import {
  ApiRemoteError,
  DefaultNovelApiClient,
  UserMessageInputEvent,
} from "../dist/index.js";
import {
  DeterministicMockClock,
  DeterministicMockNovelHost,
  MockElectronApiTransport,
  MockHttpWebSocketApiTransport,
  MockTransportDisconnectedError,
  MockTransportFaultController,
} from "../dist/testing/index.js";

const transportCases = [
  ["electron", MockElectronApiTransport],
  ["http-websocket", MockHttpWebSocketApiTransport],
];

for (const [name, Transport] of transportCases) {
  await runTransportContract(name, Transport);
  await runReconnectContract(name, Transport);
  await runNotFoundContract(name, Transport);
}
await runSharedHostContract();

console.log("mock client transports smoke passed");

async function runTransportContract(name, Transport) {
  const logs = [];
  const logger = createCollectingLogger(logs);
  const clock = new DeterministicMockClock({
    start: "2026-08-02T01:00:00.000Z",
  });
  const host = new DeterministicMockNovelHost({ clock, logger });
  const conversationId = `conversation-${name}`;
  host.registerConversation({
    snapshot: createSnapshot(conversationId),
    runtimePresence: {
      state: "offline",
      observedAt: "2026-08-02T01:00:00.000Z",
    },
  });
  const faults = new MockTransportFaultController();
  const transport = new Transport({ host, faultController: faults, logger });
  const api = new DefaultNovelApiClient({ transport, logger });
  const conversation = await api.conversations.open(conversationId);
  const events = conversation.events.subscribe({ start: { from: "start" } });

  const privateText = `private-${name}-novel-text`;
  const input = new UserMessageInputEvent({
    id: `evt-${name}-user-1`,
    timestamp: "2026-08-02T01:00:01.000Z",
    text: privateText,
  });
  const receipt = await conversation.input.enqueue(input);
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.sequence, 1);

  const persistedInput = await readEvent(events);
  assert.equal(persistedInput.direction, "input");
  assert.equal(persistedInput.sequence, 1);
  assert.equal(persistedInput.id, input.id);

  const duplicate = await conversation.input.enqueue(input);
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.sequence, 1);
  const inputOnlyPage = await conversation.events.list({
    anchor: { from: "start" },
  });
  assert.equal(inputOnlyPage.events.length, 1);

  await host.appendOutput(
    createAssistantOutput(conversationId, `evt-${name}-assistant-1`, 1),
  );
  const assistant = await readEvent(events);
  assert.equal(assistant.direction, "output");
  assert.equal(assistant.sequence, 2);

  host.setRuntimePresence(conversationId, {
    state: "online",
    observedAt: "2026-08-02T01:00:02.000Z",
  });
  assert.deepEqual(await conversation.getRuntimePresence(), {
    state: "online",
    observedAt: "2026-08-02T01:00:02.000Z",
  });

  faults.duplicateNextEventDelivery();
  await host.appendOutput(
    createAssistantOutput(conversationId, `evt-${name}-assistant-2`, 2),
  );
  const firstDelivery = await readEvent(events);
  const duplicateDelivery = await readEvent(events);
  assert.equal(firstDelivery.sequence, 3);
  assert.equal(duplicateDelivery.sequence, 3);
  assert.equal(firstDelivery.id, duplicateDelivery.id);

  const snapshot = await conversation.getSnapshot();
  assert.equal(snapshot.metadata.lastJournalSequence, 3);
  assert.equal(JSON.stringify(logs).includes(privateText), false);

  await conversation.close();
  await transport.close();
  await host.close();
}

async function runReconnectContract(name, Transport) {
  const host = new DeterministicMockNovelHost({
    clock: new DeterministicMockClock({
      start: "2026-08-02T02:00:00.000Z",
    }),
  });
  const conversationId = `conversation-${name}-reconnect`;
  host.registerConversation({ snapshot: createSnapshot(conversationId) });
  const faults = new MockTransportFaultController();
  const transport = new Transport({ host, faultController: faults });
  const api = new DefaultNovelApiClient({ transport });
  const conversation = await api.conversations.open(conversationId);
  const events = conversation.events.subscribe({ start: { from: "start" } });

  await conversation.input.enqueue(
    new UserMessageInputEvent({
      id: `evt-${name}-reconnect-user`,
      text: "reconnect",
    }),
  );
  assert.equal((await readEvent(events)).sequence, 1);

  faults.disconnect();
  await assert.rejects(
    conversation.getSnapshot(),
    MockTransportDisconnectedError,
  );
  await assert.rejects(events.next(), MockTransportDisconnectedError);

  await host.appendOutput(
    createAssistantOutput(conversationId, `evt-${name}-offline-output`, 1),
  );
  faults.reconnect();

  const resumedConversation = await api.conversations.open(conversationId);
  const resumedEvents = resumedConversation.events.subscribe({
    start: { afterSequence: 1 },
  });
  const caughtUp = await readEvent(resumedEvents);
  assert.equal(caughtUp.sequence, 2);
  assert.equal(caughtUp.id, `evt-${name}-offline-output`);

  await conversation.close();
  await resumedConversation.close();
  await transport.close();
  await host.close();
}

async function runNotFoundContract(name, Transport) {
  const host = new DeterministicMockNovelHost();
  const transport = new Transport({ host });
  const api = new DefaultNovelApiClient({ transport });
  await assert.rejects(
    api.conversations.open(`missing-${name}`),
    (error) =>
      error instanceof ApiRemoteError &&
      error.code === "CONVERSATION_NOT_FOUND" &&
      error.category === "not-found" &&
      error.retryable === false,
  );
  await transport.close();
  await host.close();
}

async function runSharedHostContract() {
  const host = new DeterministicMockNovelHost({
    clock: new DeterministicMockClock({
      start: "2026-08-02T03:00:00.000Z",
    }),
  });
  const conversationId = "conversation-shared-host";
  host.registerConversation({ snapshot: createSnapshot(conversationId) });
  const electronTransport = new MockElectronApiTransport({ host });
  const webTransport = new MockHttpWebSocketApiTransport({ host });
  const electronApi = new DefaultNovelApiClient({
    transport: electronTransport,
  });
  const webApi = new DefaultNovelApiClient({ transport: webTransport });
  const electronConversation = await electronApi.conversations.open(conversationId);
  const webConversation = await webApi.conversations.open(conversationId);
  const electronEvents = electronConversation.events.subscribe({
    start: { from: "latest" },
  });
  const webEvents = webConversation.events.subscribe({
    start: { from: "latest" },
  });

  // compose 状态（含 purpose）经客户端 validator 键白名单往返。
  const composeConversationId = "conversation-shared-compose";
  host.registerConversation({
    snapshot: createSnapshot(composeConversationId),
    composeState: Object.freeze({
      phase: "designing",
      designFilePath: "/ws/.novel/design/conversation-shared-compose.md",
      preMode: "review",
      updatedAt: "2026-08-02T04:00:00.000Z",
      purpose: "第三章大纲",
    }),
  });
  const composeClient = await electronApi.conversations.open(
    composeConversationId,
  );
  const composeState = await composeClient.getComposeState();
  assert.equal(composeState.phase, "designing");
  assert.equal(composeState.purpose, "第三章大纲");

  const input = new UserMessageInputEvent({
    id: "evt-shared-user",
    text: "shared clients",
  });
  await electronConversation.input.enqueue(input);
  const [electronInput, webInput] = await Promise.all([
    readEvent(electronEvents),
    readEvent(webEvents),
  ]);
  assert.equal(electronInput.sequence, 1);
  assert.equal(webInput.sequence, 1);
  assert.equal(electronInput.id, webInput.id);

  await host.appendOutput(
    createAssistantOutput(conversationId, "evt-shared-assistant", 1),
  );
  const [electronOutput, webOutput] = await Promise.all([
    readEvent(electronEvents),
    readEvent(webEvents),
  ]);
  assert.equal(electronOutput.sequence, 2);
  assert.equal(webOutput.sequence, 2);
  assert.equal(electronOutput.id, webOutput.id);

  await electronConversation.close();
  await webConversation.close();
  await electronTransport.close();
  await webTransport.close();
  await host.close();
}

function createSnapshot(conversationId) {
  return Object.freeze({
    metadata: Object.freeze({
      id: conversationId,
      workspaceId: "workspace-mock-client",
      rootConversationId: conversationId,
      status: "active",
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
      lastJournalSequence: 0,
    }),
    activeAgentBinding: Object.freeze({
      id: `binding-${conversationId}`,
      conversationId,
      revision: 1,
      agentType: "novel.main",
      definitionVersion: "1",
      status: "active",
      createdAt: "2026-08-02T00:00:00.000Z",
    }),
  });
}

function createAssistantOutput(conversationId, eventId, part) {
  return Object.freeze({
    id: eventId,
    conversationId,
    eventType: "agent.message",
    schemaVersion: 1,
    timestamp: `2026-08-02T03:00:0${part}.000Z`,
    payload: Object.freeze({ part }),
  });
}

async function readEvent(subscription) {
  const result = await subscription.next();
  assert.equal(result.done, false);
  return result.value;
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
