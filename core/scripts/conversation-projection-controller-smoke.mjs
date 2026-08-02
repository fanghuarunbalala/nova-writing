import assert from "node:assert/strict";
import {
  CONVERSATION_PROJECTION_CONTROLLER_STATE,
  ConversationProjectionController,
  ConversationProjectionControllerStateError,
  ConversationProjectionStore,
  DefaultNovelApiClient,
  RuntimePresenceChangedOutputEvent,
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
  await runControllerContract(name, Transport);
}

console.log("conversation projection controller smoke passed");

async function runControllerContract(name, Transport) {
  const logs = [];
  const logger = createCollectingLogger(logs);
  const host = new DeterministicMockNovelHost({
    clock: new DeterministicMockClock({
      start: "2026-08-02T05:00:00.000Z",
    }),
    logger,
  });
  const conversationId = `conversation-controller-${name}`;
  host.registerConversation({
    snapshot: createSnapshot(conversationId),
    runtimePresence: {
      state: "offline",
      observedAt: "2026-08-02T05:00:00.000Z",
    },
  });
  const faults = new MockTransportFaultController();
  const transport = new Transport({ host, faultController: faults, logger });
  const api = new DefaultNovelApiClient({ transport, logger });
  const conversation = await api.conversations.open(conversationId);
  const secretText = `private-controller-${name}-manuscript`;

  await conversation.input.enqueue(
    new UserMessageInputEvent({
      id: `evt-${name}-history-user`,
      timestamp: "2026-08-02T05:00:01.000Z",
      text: secretText,
    }),
  );
  await host.appendOutput({
    id: `evt-${name}-history-output`,
    conversationId,
    eventType: "novel.history.seeded",
    schemaVersion: 1,
    timestamp: "2026-08-02T05:00:02.000Z",
    payload: { privateText: secretText },
  });

  const store = new ConversationProjectionStore({ conversationId, logger });
  const controller = new ConversationProjectionController({
    conversation,
    store,
    replayPageSize: 1,
    logger,
  });
  const observedSnapshots = [];
  controller.subscribe(() => {
    observedSnapshots.push(controller.getSnapshot());
  });

  await controller.start();
  assert.equal(controller.getSnapshot().state, "live");
  assert.equal(controller.getSnapshot().lastAppliedSequence, 2);
  assert.equal(controller.getSnapshot().runtimePresence.state, "offline");
  assert.equal(store.getSnapshot().userMessages[0].text, secretText);
  assert.ok(observedSnapshots.length > 0);
  assert.ok(observedSnapshots.every(Object.isFrozen));
  assert.throws(
    () => controller.resume(),
    ConversationProjectionControllerStateError,
  );

  const revisionBeforeDuplicate = controller.getSnapshot().revision;
  faults.duplicateNextEventDelivery();
  await conversation.input.enqueue(
    new UserMessageInputEvent({
      id: `evt-${name}-duplicate-user`,
      timestamp: "2026-08-02T05:00:03.000Z",
      text: "first live message",
    }),
  );
  await conversation.input.enqueue(
    new UserMessageInputEvent({
      id: `evt-${name}-following-user`,
      timestamp: "2026-08-02T05:00:04.000Z",
      text: "second live message",
    }),
  );
  await waitFor(() => controller.getSnapshot().lastAppliedSequence === 4);
  assert.equal(controller.getSnapshot().revision, revisionBeforeDuplicate + 2);

  await host.appendOutput(
    new RuntimePresenceChangedOutputEvent({
      id: `evt-${name}-presence-online`,
      conversationId,
      previous: {
        state: "starting",
        observedAt: "2026-08-02T05:00:04.500Z",
      },
      current: {
        state: "online",
        observedAt: "2026-08-02T05:00:05.000Z",
      },
      reason: "activation_succeeded",
    }).getSnapshot(),
  );
  await waitFor(
    () => controller.getSnapshot().runtimePresence?.state === "online",
  );
  assert.equal(controller.getSnapshot().lastAppliedSequence, 5);

  faults.disconnect();
  await waitFor(
    () =>
      controller.getSnapshot().state ===
      CONVERSATION_PROJECTION_CONTROLLER_STATE.disconnected,
  );
  assert.deepEqual(controller.getSnapshot().error, {
    code: "API_TRANSPORT_DISCONNECTED",
    retryable: true,
    category: "transport",
  });

  await host.appendOutput({
    id: `evt-${name}-offline-output`,
    conversationId,
    eventType: "novel.offline.persisted",
    schemaVersion: 1,
    timestamp: "2026-08-02T05:00:06.000Z",
    payload: { privateText: secretText },
  });
  assert.equal(controller.getSnapshot().lastAppliedSequence, 5);

  faults.reconnect();
  await controller.resume();
  assert.equal(controller.getSnapshot().state, "live");
  assert.equal(controller.getSnapshot().lastAppliedSequence, 6);
  assert.equal(controller.getSnapshot().error, undefined);

  const firstStop = controller.stop();
  const secondStop = controller.stop();
  assert.equal(firstStop, secondStop);
  await firstStop;
  assert.equal(controller.getSnapshot().state, "stopped");
  const stoppedSequence = controller.getSnapshot().lastAppliedSequence;

  await conversation.input.enqueue(
    new UserMessageInputEvent({
      id: `evt-${name}-post-stop-user`,
      timestamp: "2026-08-02T05:00:07.000Z",
      text: "conversation remains open",
    }),
  );
  await delay(20);
  assert.equal(controller.getSnapshot().lastAppliedSequence, stoppedSequence);
  assert.throws(
    () => controller.start(),
    ConversationProjectionControllerStateError,
  );
  assert.equal(JSON.stringify(logs).includes(secretText), false);

  await conversation.close();
  await transport.close();
  await host.close();
}

function createSnapshot(conversationId) {
  return Object.freeze({
    metadata: Object.freeze({
      id: conversationId,
      workspaceId: "workspace-controller",
      rootConversationId: conversationId,
      status: "active",
      createdAt: "2026-08-02T05:00:00.000Z",
      updatedAt: "2026-08-02T05:00:00.000Z",
      lastJournalSequence: 0,
    }),
    activeAgentBinding: Object.freeze({
      id: `binding-${conversationId}`,
      conversationId,
      revision: 1,
      agentType: "novel.main",
      definitionVersion: "1",
      status: "active",
      createdAt: "2026-08-02T05:00:00.000Z",
    }),
  });
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for Projection Controller state");
    }
    await delay(5);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
