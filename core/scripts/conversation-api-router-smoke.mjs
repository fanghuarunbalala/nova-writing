import assert from "node:assert/strict";
import {
  API_PROTOCOL_VERSION,
  ApiRemoteError,
  ApiTransportError,
  ConversationApiRouter,
  ConversationAlreadyExistsError,
  ConversationNotFoundError,
  DefaultNovelApiClient,
  UserMessageInputEvent,
} from "../dist/index.js";

async function run() {
const conversationId = "conversation-router";
const logs = [];
const services = new TestConversationServices(conversationId);
const router = new ConversationApiRouter({
  catalog: services,
  commands: services,
  queries: services,
  runtimePresence: services,
  logger: createCollectingLogger(logs),
});
const api = new DefaultNovelApiClient({
  transport: router,
  requestIdFactory: createRequestIdFactory(),
  logger: createCollectingLogger(logs),
});

const createdConversation = await api.conversations.create({
  conversationId: "conversation-router-created",
  agent: {
    agentType: "conversation.main",
    definitionVersion: "2",
  },
});
assert.equal(createdConversation.id, "conversation-router-created");
const catalog = await api.conversations.list({ status: "active", limit: 10 });
assert.deepEqual(
  catalog.conversations.map((snapshot) => snapshot.metadata.id),
  [conversationId, "conversation-router-created"],
);
assert.equal(
  catalog.conversations[1].activeAgentBinding.definitionVersion,
  "2",
);
await createdConversation.close();

await assert.rejects(
  api.conversations.create({
    conversationId: "conversation-router-created",
    agent: {
      agentType: "conversation.main",
      definitionVersion: "2",
    },
  }),
  (error) =>
    error instanceof ApiRemoteError &&
    error.code === "CONVERSATION_ALREADY_EXISTS" &&
    error.category === "conflict",
);

const conversation = await api.conversations.open(conversationId);
const events = conversation.events.subscribe({ start: { from: "start" } });
const privateText = "private-conversation-router-message";
const receipt = await conversation.input.enqueue(
  new UserMessageInputEvent({
    id: "input-router-1",
    timestamp: "2026-08-03T01:00:01.000Z",
    text: privateText,
  }),
);
assert.deepEqual(receipt, {
  status: "accepted",
  conversationId,
  inputEventId: "input-router-1",
  sequence: 1,
  acceptedAt: "2026-08-03T01:00:01.000Z",
});

const delivered = await events.next();
assert.equal(delivered.done, false);
assert.equal(delivered.value.id, "input-router-1");
assert.equal(delivered.value.sequence, 1);
assert.equal(delivered.value.payload.text, privateText);

const page = await conversation.events.list({
  anchor: { from: "start" },
});
assert.equal(page.events.length, 1);
assert.equal(page.highWatermark, 1);
assert.deepEqual(await conversation.getRuntimePresence(), {
  state: "online",
  observedAt: "2026-08-03T01:00:00.000Z",
});
assert.equal((await conversation.getSnapshot()).metadata.lastJournalSequence, 1);

await assert.rejects(
  api.conversations.open("missing-conversation"),
  (error) =>
    error instanceof ApiRemoteError &&
    error.code === "CONVERSATION_NOT_FOUND" &&
    error.category === "not-found" &&
    error.retryable === false,
);

const invalidOperation = await router.request({
  protocolVersion: API_PROTOCOL_VERSION,
  requestId: "request-invalid-operation",
  operation: "novel.query.get",
  payload: { conversationId },
});
assert.equal(invalidOperation.ok, false);
assert.equal(invalidOperation.error.code, "INVALID_API_REQUEST");
assert.equal(invalidOperation.error.category, "validation");

const mismatchedInput = await router.request({
  protocolVersion: API_PROTOCOL_VERSION,
  requestId: "request-mismatched-input",
  operation: "conversation.input.enqueue",
  payload: {
    conversationId,
    inputEvent: new UserMessageInputEvent({
      id: "input-router-mismatch",
      conversationId: "another-conversation",
      text: "mismatch",
    }).getSnapshot(),
  },
});
assert.equal(mismatchedInput.ok, false);
assert.equal(mismatchedInput.error.code, "INVALID_API_REQUEST");

assert.equal(JSON.stringify(logs).includes(privateText), false);
await conversation.close();
await router.close();
await assert.rejects(
  api.conversations.open(conversationId),
  (error) =>
    error instanceof ApiTransportError &&
    error.code === "HOST_UNAVAILABLE" &&
    error.retryable === true,
);

console.log("conversation api router smoke passed");
}

class TestConversationServices {
  constructor(registeredConversationId) {
    this.registeredConversationId = registeredConversationId;
    this.events = [];
    this.eventIds = new Map();
    this.subscriptions = new Set();
    this.snapshot = createSnapshot(registeredConversationId);
    this.catalogSnapshots = [this.snapshot];
  }

  async create(options) {
    const conversationId = options.conversationId ?? "conversation-router-generated";
    if (
      this.catalogSnapshots.some(
        (snapshot) => snapshot.metadata.id === conversationId,
      )
    ) {
      throw new ConversationAlreadyExistsError(conversationId);
    }
    const timestamp = "2026-08-03T01:00:00.000Z";
    const snapshot = Object.freeze({
      metadata: Object.freeze({
        id: conversationId,
        workspaceId: "workspace-router",
        ...(options.parentConversationId !== undefined
          ? { parentConversationId: options.parentConversationId }
          : {}),
        rootConversationId: options.parentConversationId ?? conversationId,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
        lastJournalSequence: 0,
      }),
      activeAgentBinding: Object.freeze({
        id: `binding-${conversationId}`,
        conversationId,
        revision: 1,
        ...options.agent,
        status: "active",
        createdAt: timestamp,
      }),
    });
    this.catalogSnapshots.push(snapshot);
    return snapshot;
  }

  async list(options = {}) {
    return {
      conversations: this.catalogSnapshots
        .filter(
          (snapshot) =>
            options.status === undefined ||
            snapshot.metadata.status === options.status,
        )
        .slice(0, options.limit),
    };
  }

  async enqueue(requestConversationId, event) {
    this.requireConversation(requestConversationId);
    const snapshot = event.getSnapshot(requestConversationId);
    const existing = this.eventIds.get(snapshot.id);
    if (existing !== undefined) {
      return {
        status: "duplicate",
        conversationId: requestConversationId,
        inputEventId: snapshot.id,
        sequence: existing.sequence,
        acceptedAt: existing.recordedAt,
      };
    }
    const persisted = Object.freeze({
      ...snapshot,
      payload: Object.freeze({ ...snapshot.payload }),
      direction: "input",
      sequence: this.events.length + 1,
      recordedAt: snapshot.timestamp,
    });
    this.events.push(persisted);
    this.eventIds.set(snapshot.id, persisted);
    this.snapshot = Object.freeze({
      metadata: Object.freeze({
        ...this.snapshot.metadata,
        updatedAt: snapshot.timestamp,
        lastJournalSequence: persisted.sequence,
      }),
      activeAgentBinding: this.snapshot.activeAgentBinding,
    });
    for (const subscription of this.subscriptions) subscription.publish(persisted);
    return {
      status: "accepted",
      conversationId: requestConversationId,
      inputEventId: snapshot.id,
      sequence: persisted.sequence,
      acceptedAt: persisted.recordedAt,
    };
  }

  async getSnapshot(requestConversationId) {
    this.requireConversation(requestConversationId);
    return this.snapshot;
  }

  async listEvents(requestConversationId) {
    this.requireConversation(requestConversationId);
    return {
      events: [...this.events],
      highWatermark: this.events.length,
      hasPrevious: false,
      hasNext: false,
    };
  }

  subscribeEvents(requestConversationId) {
    this.requireConversation(requestConversationId);
    let subscription;
    subscription = new TestConversationSubscription(
      `subscription-${this.subscriptions.size + 1}`,
      requestConversationId,
      () => this.subscriptions.delete(subscription),
    );
    this.subscriptions.add(subscription);
    for (const event of this.events) subscription.publish(event);
    return subscription;
  }

  async getRuntimePresence(requestConversationId) {
    this.requireConversation(requestConversationId);
    return {
      state: "online",
      observedAt: "2026-08-03T01:00:00.000Z",
    };
  }

  requireConversation(requestConversationId) {
    if (requestConversationId !== this.registeredConversationId) {
      throw new ConversationNotFoundError(requestConversationId);
    }
  }
}

class TestConversationSubscription {
  constructor(id, registeredConversationId, onClose) {
    this.id = id;
    this.conversationId = registeredConversationId;
    this.onClose = onClose;
    this.queue = [];
    this.readers = [];
    this.closed = false;
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  next() {
    const event = this.queue.shift();
    if (event !== undefined) return Promise.resolve({ done: false, value: event });
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve) => this.readers.push(resolve));
  }

  publish(event) {
    const reader = this.readers.shift();
    if (reader !== undefined) {
      reader({ done: false, value: event });
      return;
    }
    this.queue.push(event);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
    for (const reader of this.readers.splice(0)) {
      reader({ done: true, value: undefined });
    }
  }
}

function createSnapshot(id) {
  return Object.freeze({
    metadata: Object.freeze({
      id,
      workspaceId: "workspace-conversation-router",
      rootConversationId: id,
      status: "active",
      createdAt: "2026-08-03T01:00:00.000Z",
      updatedAt: "2026-08-03T01:00:00.000Z",
      lastJournalSequence: 0,
    }),
    activeAgentBinding: Object.freeze({
      id: `binding-${id}`,
      conversationId: id,
      revision: 1,
      agentType: "conversation.main",
      definitionVersion: "1",
      status: "active",
      createdAt: "2026-08-03T01:00:00.000Z",
    }),
  });
}

function createRequestIdFactory() {
  let value = 0;
  return () => `conversation-router-request-${++value}`;
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

await run();
