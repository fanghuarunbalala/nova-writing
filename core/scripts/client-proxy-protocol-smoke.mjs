import assert from "node:assert/strict";
import {
  API_PROTOCOL_VERSION,
  ApiRemoteError,
  CONVERSATION_API_OPERATION,
  ConversationClientProtocolError,
  ConversationHandleClosedError,
  DefaultNovelApiClient,
  UserMessageInputEvent,
} from "../dist/index.js";
import {
  ScriptedApiSubscription,
  ScriptedApiTransport,
} from "../dist/testing/index.js";

const conversationId = "conversation-client-protocol";
const timestamp = "2026-08-02T00:00:00.000Z";
const secretText = "private novel text must not appear in logs";

const snapshot = Object.freeze({
  metadata: Object.freeze({
    id: conversationId,
    workspaceId: "workspace-client-protocol",
    rootConversationId: conversationId,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastJournalSequence: 2,
  }),
  activeAgentBinding: Object.freeze({
    id: "binding-client-protocol",
    conversationId,
    revision: 1,
    agentType: "novel.main",
    definitionVersion: "1",
    status: "active",
    createdAt: timestamp,
  }),
});

const persistedOutput = Object.freeze({
  id: "evt_assistant_1",
  conversationId,
  eventType: "agent.message",
  schemaVersion: 1,
  timestamp,
  payload: Object.freeze({ text: "safe fixture" }),
  direction: "output",
  sequence: 2,
  recordedAt: timestamp,
});

let activeSubscription;
const logs = [];
const transport = new ScriptedApiTransport({
  request: async (request) => {
    const success = (data) => ({
      protocolVersion: API_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      data,
    });

    switch (request.operation) {
      case CONVERSATION_API_OPERATION.snapshotGet:
        return success(snapshot);
      case CONVERSATION_API_OPERATION.runtimePresenceGet:
        return success({ state: "online", observedAt: timestamp });
      case CONVERSATION_API_OPERATION.inputEnqueue:
        return success({
          status: "accepted",
          conversationId,
          inputEventId: request.payload.inputEvent.id,
          sequence: 3,
          acceptedAt: timestamp,
        });
      case CONVERSATION_API_OPERATION.eventsList:
        return success({
          events: [persistedOutput],
          highWatermark: 2,
          hasPrevious: false,
          hasNext: false,
        });
      default:
        throw new Error(`Unexpected operation: ${request.operation}`);
    }
  },
  subscribe: (request) => {
    assert.equal(request.operation, CONVERSATION_API_OPERATION.eventsSubscribe);
    activeSubscription = new ScriptedApiSubscription({
      id: "subscription-client-protocol",
      frames: [
        {
          protocolVersion: API_PROTOCOL_VERSION,
          subscriptionId: "subscription-client-protocol",
          event: persistedOutput,
        },
      ],
    });
    return activeSubscription;
  },
});

const logger = {
  debug: (event, fields) => logs.push({ level: "debug", event, fields }),
  info: (event, fields) => logs.push({ level: "info", event, fields }),
  warn: (event, fields) => logs.push({ level: "warn", event, fields }),
  error: (event, fields) => logs.push({ level: "error", event, fields }),
  child() {
    return this;
  },
};

let requestIndex = 0;
const api = new DefaultNovelApiClient({
  transport,
  requestIdFactory: () => `request-${++requestIndex}`,
  logger,
});

const conversation = await api.conversations.open(conversationId);
assert.equal(conversation.id, conversationId);
assert.equal(conversation.parentConversationId, undefined);
assert.equal(transport.requests[0].operation, CONVERSATION_API_OPERATION.snapshotGet);
assert.deepEqual(transport.requests[0].payload, { conversationId });

const refreshedSnapshot = await conversation.getSnapshot();
assert.equal(refreshedSnapshot.metadata.id, conversationId);
assert.equal(Object.isFrozen(refreshedSnapshot.metadata), true);

const presence = await conversation.getRuntimePresence();
assert.deepEqual(presence, { state: "online", observedAt: timestamp });

const input = new UserMessageInputEvent({
  id: "evt_user_1",
  timestamp,
  text: secretText,
});
const receipt = await conversation.input.enqueue(input);
assert.deepEqual(receipt, {
  status: "accepted",
  conversationId,
  inputEventId: "evt_user_1",
  sequence: 3,
  acceptedAt: timestamp,
});
const enqueueRequest = transport.requests.find(
  (request) => request.operation === CONVERSATION_API_OPERATION.inputEnqueue,
);
assert.equal(enqueueRequest.payload.conversationId, conversationId);
assert.equal(enqueueRequest.payload.inputEvent.conversationId, conversationId);
assert.equal(enqueueRequest.payload.inputEvent.payload.text, secretText);

const page = await conversation.events.list({
  anchor: { from: "start" },
  eventTypes: ["agent.message"],
});
assert.equal(page.events.length, 1);
assert.equal(page.events[0].sequence, 2);
assert.equal(Object.isFrozen(page.events[0]), true);

const abortController = new AbortController();
const subscription = conversation.events.subscribe({
  start: { afterSequence: 1 },
  signal: abortController.signal,
});
assert.deepEqual(transport.subscriptionRequests[0].payload, {
  conversationId,
  options: { start: { afterSequence: 1 } },
});
assert.equal(
  transport.subscriptionOptions[0].signal,
  abortController.signal,
);
const streamed = await subscription.next();
assert.equal(streamed.done, false);
assert.equal(streamed.value.sequence, 2);
assert.equal(streamed.value.conversationId, conversationId);

await conversation.close();
assert.equal(activeSubscription.closeCalls, 1);
assert.throws(() => conversation.getSnapshot(), ConversationHandleClosedError);
assert.equal(JSON.stringify(logs).includes(secretText), false);

await testRemoteError();
await testProtocolMismatch();
await testRequestIdMismatch();
await testConversationMismatch();
await testInputConversationMismatch();
await testSubscriptionFrameMismatch();

console.log("client proxy protocol smoke passed");

async function testRemoteError() {
  const remoteTransport = new ScriptedApiTransport({
    request: async (request) => ({
      protocolVersion: API_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: false,
      error: {
        code: "CONVERSATION_UNAVAILABLE",
        category: "unavailable",
        retryable: true,
        message: "Conversation is temporarily unavailable",
      },
    }),
    subscribe: () => new ScriptedApiSubscription({ id: "unused" }),
  });
  const remoteApi = new DefaultNovelApiClient({ transport: remoteTransport });
  await assert.rejects(
    remoteApi.conversations.open(conversationId),
    (error) =>
      error instanceof ApiRemoteError &&
      error.code === "CONVERSATION_UNAVAILABLE" &&
      error.retryable,
  );
}

async function testProtocolMismatch() {
  const invalidTransport = new ScriptedApiTransport({
    request: async (request) => ({
      protocolVersion: 99,
      requestId: request.requestId,
      ok: true,
      data: snapshot,
    }),
    subscribe: () => new ScriptedApiSubscription({ id: "unused" }),
  });
  const invalidApi = new DefaultNovelApiClient({ transport: invalidTransport });
  await assert.rejects(
    invalidApi.conversations.open(conversationId),
    ConversationClientProtocolError,
  );
}

async function testConversationMismatch() {
  const mismatchTransport = new ScriptedApiTransport({
    request: async (request) => ({
      protocolVersion: API_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      data: {
        ...snapshot,
        metadata: { ...snapshot.metadata, id: "another-conversation" },
      },
    }),
    subscribe: () => new ScriptedApiSubscription({ id: "unused" }),
  });
  const mismatchApi = new DefaultNovelApiClient({ transport: mismatchTransport });
  await assert.rejects(
    mismatchApi.conversations.open(conversationId),
    ConversationClientProtocolError,
  );
}

async function testRequestIdMismatch() {
  const invalidTransport = new ScriptedApiTransport({
    request: async () => ({
      protocolVersion: API_PROTOCOL_VERSION,
      requestId: "another-request",
      ok: true,
      data: snapshot,
    }),
    subscribe: () => new ScriptedApiSubscription({ id: "unused" }),
  });
  const invalidApi = new DefaultNovelApiClient({ transport: invalidTransport });
  await assert.rejects(
    invalidApi.conversations.open(conversationId),
    ConversationClientProtocolError,
  );
}

async function testInputConversationMismatch() {
  const mismatchTransport = new ScriptedApiTransport({
    request: async (request) => ({
      protocolVersion: API_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      data: snapshot,
    }),
    subscribe: () => new ScriptedApiSubscription({ id: "unused" }),
  });
  const mismatchApi = new DefaultNovelApiClient({ transport: mismatchTransport });
  const mismatchConversation = await mismatchApi.conversations.open(conversationId);
  await assert.rejects(
    mismatchConversation.input.enqueue(
      new UserMessageInputEvent({
        conversationId: "another-conversation",
        text: "mismatch",
      }),
    ),
  );
  assert.equal(mismatchTransport.requests.length, 1);
}

async function testSubscriptionFrameMismatch() {
  let invalidSubscription;
  const invalidTransport = new ScriptedApiTransport({
    request: async (request) => ({
      protocolVersion: API_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      data: snapshot,
    }),
    subscribe: () => {
      invalidSubscription = new ScriptedApiSubscription({
        id: "expected-subscription",
        frames: [
          {
            protocolVersion: API_PROTOCOL_VERSION,
            subscriptionId: "another-subscription",
            event: persistedOutput,
          },
        ],
      });
      return invalidSubscription;
    },
  });
  const invalidApi = new DefaultNovelApiClient({ transport: invalidTransport });
  const invalidConversation = await invalidApi.conversations.open(conversationId);
  const invalidEvents = invalidConversation.events.subscribe({
    start: { from: "latest" },
  });
  await assert.rejects(
    invalidEvents.next(),
    ConversationClientProtocolError,
  );
  assert.equal(invalidSubscription.closeCalls, 1);
}
