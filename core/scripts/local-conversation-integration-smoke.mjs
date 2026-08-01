import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConversationHandleClosedError,
  ConversationHandleClosingError,
  ConversationNotFoundError,
  InMemoryConversationEventHub,
  JournalConversationEventSubscriptionService,
  LocalConversation,
  LocalConversationFactory,
  PublishingConversationJournalService,
  RUNTIME_PRESENCE_STATE,
  StorageConversationQueryService,
  UserMessageInputEvent,
} from "../dist/index.js";
import {
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
} from "../dist/node/index.js";

class CollectingLogger {
  constructor(entries, bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }

  debug(event, fields = {}) {
    this.record("debug", event, fields);
  }

  info(event, fields = {}) {
    this.record("info", event, fields);
  }

  warn(event, fields = {}) {
    this.record("warn", event, fields);
  }

  error(event, fields = {}) {
    this.record("error", event, fields);
  }

  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }

  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

class RecordingCommandService {
  constructor() {
    this.calls = [];
  }

  async enqueue(conversationId, event) {
    this.calls.push({ conversationId, event });
    throw new Error("read-only smoke must not enter command path");
  }
}

class RecordingPresenceReader {
  constructor() {
    this.calls = [];
  }

  async getRuntimePresence(conversationId) {
    this.calls.push(conversationId);
    return Object.freeze({
      state: RUNTIME_PRESENCE_STATE.offline,
      observedAt: "2026-08-01T00:00:00.000Z",
    });
  }
}

class ControlledSubscription {
  constructor({ id, conversationId, closeGate, closeFailure }) {
    this.id = id;
    this.conversationId = conversationId;
    this.closeGate = closeGate;
    this.closeFailure = closeFailure;
    this.closeCalls = 0;
    this.closed = false;
  }

  async next() {
    return { done: this.closed, value: undefined };
  }

  async return() {
    await this.close();
    return { done: true, value: undefined };
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  async close() {
    this.closeCalls += 1;
    if (this.closeGate !== undefined) await this.closeGate.promise;
    this.closed = true;
    if (this.closeFailure !== undefined) throw this.closeFailure;
  }
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createSnapshot(conversationId = "conversation-lifecycle") {
  return Object.freeze({
    metadata: Object.freeze({
      id: conversationId,
      workspaceId: "workspace-lifecycle",
      rootConversationId: conversationId,
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      lastJournalSequence: 0,
    }),
    activeAgentBinding: Object.freeze({
      id: "binding-lifecycle",
      conversationId,
      revision: 1,
      agentType: "novel.main",
      definitionVersion: "1",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
    }),
  });
}

function createInputRequest({ conversationId, eventId, timestamp, text }) {
  return {
    direction: "input",
    snapshot: new UserMessageInputEvent({
      conversationId,
      id: eventId,
      timestamp,
      text,
    }).getSnapshot(),
  };
}

function createOutputRequest({ conversationId, eventId, timestamp, text }) {
  return {
    direction: "output",
    snapshot: {
      id: eventId,
      conversationId,
      eventType: "agent.message",
      schemaVersion: 1,
      timestamp,
      payload: { text },
    },
  };
}

async function readEvent(subscription) {
  const result = await subscription.next();
  assert.equal(result.done, false);
  return result.value;
}

async function testHandleLifecycle(logEntries) {
  const closeGate = createDeferred();
  const slowSubscription = new ControlledSubscription({
    id: "slow-subscription",
    conversationId: "conversation-lifecycle",
    closeGate,
  });
  const snapshot = createSnapshot();
  const queryService = {
    getSnapshot: async () => snapshot,
    listEvents: async () => ({
      events: [],
      highWatermark: 0,
      hasPrevious: false,
      hasNext: false,
    }),
    subscribeEvents: () => slowSubscription,
  };
  const handle = new LocalConversation({
    snapshot,
    queryService,
    commandService: new RecordingCommandService(),
    runtimePresenceReader: new RecordingPresenceReader(),
    logger: new CollectingLogger(logEntries),
  });
  const owned = handle.events.subscribe({ start: { from: "latest" } });
  const close = handle.close();

  assert.equal(handle.close(), close);
  assert.throws(() => handle.getSnapshot(), ConversationHandleClosingError);
  assert.throws(
    () => handle.events.list({ anchor: { from: "start" } }),
    ConversationHandleClosingError,
  );
  closeGate.resolve();
  await close;

  assert.equal(slowSubscription.closeCalls, 1);
  assert.deepEqual(await owned.next(), { done: true, value: undefined });
  assert.throws(() => handle.getRuntimePresence(), ConversationHandleClosedError);
  assert.throws(
    () => handle.events.subscribe({ start: { from: "latest" } }),
    ConversationHandleClosedError,
  );

  const failures = [
    new Error("forbidden-close-failure-one"),
    new Error("forbidden-close-failure-two"),
  ];
  const failingSubscriptions = failures.map(
    (failure, index) =>
      new ControlledSubscription({
        id: `failing-subscription-${index + 1}`,
        conversationId: "conversation-failing-close",
        closeFailure: failure,
      }),
  );
  let subscriptionIndex = 0;
  const failingSnapshot = createSnapshot("conversation-failing-close");
  const failingHandle = new LocalConversation({
    snapshot: failingSnapshot,
    queryService: {
      getSnapshot: async () => failingSnapshot,
      listEvents: queryService.listEvents,
      subscribeEvents: () => failingSubscriptions[subscriptionIndex++],
    },
    commandService: new RecordingCommandService(),
    runtimePresenceReader: new RecordingPresenceReader(),
    logger: new CollectingLogger(logEntries),
  });
  failingHandle.events.subscribe({ start: { from: "latest" } });
  failingHandle.events.subscribe({ start: { from: "latest" } });

  await assert.rejects(failingHandle.close(), AggregateError);
  assert.deepEqual(
    failingSubscriptions.map((subscription) => subscription.closeCalls),
    [1, 1],
  );
  assert.throws(() => failingHandle.getSnapshot(), ConversationHandleClosedError);
}

async function testSqliteReadOnlyPath(logEntries) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-local-conversation-"));
  const workspaceRoot = join(temporaryRoot, "workspace");
  const storageRoot = join(temporaryRoot, "storage");
  const parentConversationId = "conversation-parent";
  const conversationId = "conversation-main";
  const otherConversationId = "conversation-other";
  const secretText = "SMOKE_SECRET_LOCAL_CONVERSATION";
  const logger = new CollectingLogger(logEntries);

  try {
    await mkdir(workspaceRoot, { recursive: true });
    const locator = new NodeWorkspaceStoreLocator({ storageRoot });
    const location = await locator.resolve(workspaceRoot);
    const store = await SqliteWorkspaceStore.open({ workspace: location, logger });
    await store.conversations.createConversation({
      id: parentConversationId,
      workspaceId: location.workspaceId,
      agent: { agentType: "novel.parent", definitionVersion: "1" },
    });
    await store.conversations.createConversation({
      id: conversationId,
      workspaceId: location.workspaceId,
      parentConversationId,
      agent: { agentType: "novel.main", definitionVersion: "7" },
    });
    await store.conversations.createConversation({
      id: otherConversationId,
      workspaceId: location.workspaceId,
      agent: { agentType: "novel.other", definitionVersion: "1" },
    });

    const hub = new InMemoryConversationEventHub({ logger });
    const publisher = new PublishingConversationJournalService({
      journal: store.journal,
      hub,
      logger,
    });
    const subscriptionService = new JournalConversationEventSubscriptionService({
      journal: store.journal,
      hub,
      logger,
      pageSize: 2,
    });
    const queryService = new StorageConversationQueryService({
      catalog: store.conversations,
      journal: store.journal,
      subscriptions: subscriptionService,
      logger,
    });
    const commandService = new RecordingCommandService();
    const presenceReader = new RecordingPresenceReader();
    const factory = new LocalConversationFactory({
      queryService,
      commandService,
      runtimePresenceReader: presenceReader,
      logger,
    });

    await publisher.append(
      createInputRequest({
        conversationId,
        eventId: "main-input-1",
        timestamp: "2026-08-01T00:00:00.000Z",
        text: secretText,
      }),
    );
    await publisher.append(
      createOutputRequest({
        conversationId,
        eventId: "main-output-2",
        timestamp: "2026-08-01T00:00:01.000Z",
        text: "history-output",
      }),
    );

    await assert.rejects(
      factory.open("conversation-missing"),
      ConversationNotFoundError,
    );
    const conversation = await factory.open(conversationId);
    assert.equal(conversation.id, conversationId);
    assert.equal(conversation.parentConversationId, parentConversationId);

    const firstSnapshot = await conversation.getSnapshot();
    const secondSnapshot = await conversation.getSnapshot();
    assert.notEqual(firstSnapshot, secondSnapshot);
    assert.equal(firstSnapshot.metadata.id, conversationId);
    assert.equal(firstSnapshot.activeAgentBinding.agentType, "novel.main");
    assert.equal(firstSnapshot.activeAgentBinding.definitionVersion, "7");
    assert.equal(Object.isFrozen(firstSnapshot), true);
    assert.equal(Object.isFrozen(firstSnapshot.metadata), true);
    assert.equal(Object.isFrozen(firstSnapshot.activeAgentBinding), true);
    assert.throws(() => {
      firstSnapshot.metadata.status = "archived";
    }, TypeError);

    const page = await conversation.events.list({
      conversationId: otherConversationId,
      anchor: { from: "start" },
      limit: 10,
    });
    assert.deepEqual(
      page.events.map((event) => event.id),
      ["main-input-1", "main-output-2"],
    );

    const subscription = conversation.events.subscribe({
      conversationId: otherConversationId,
      start: { from: "start" },
      liveBufferCapacity: 8,
    });
    await publisher.append(
      createInputRequest({
        conversationId: otherConversationId,
        eventId: "other-input-1",
        timestamp: "2026-08-01T00:00:02.000Z",
        text: "other-conversation-event",
      }),
    );
    const mainLiveAppend = publisher.append(
      createInputRequest({
        conversationId,
        eventId: "main-input-3",
        timestamp: "2026-08-01T00:00:03.000Z",
        text: "main-live-event",
      }),
    );
    const deliveries = [
      await readEvent(subscription),
      await readEvent(subscription),
      await readEvent(subscription),
    ];
    await mainLiveAppend;
    assert.deepEqual(
      deliveries.map((event) => [event.sequence, event.id]),
      [
        [1, "main-input-1"],
        [2, "main-output-2"],
        [3, "main-input-3"],
      ],
    );

    const presence = await conversation.getRuntimePresence();
    assert.deepEqual(presence, {
      state: "offline",
      observedAt: "2026-08-01T00:00:00.000Z",
    });
    assert.deepEqual(presenceReader.calls, [conversationId]);
    assert.equal(commandService.calls.length, 0);

    await conversation.close();
    await conversation.close();
    assert.deepEqual(await subscription.next(), { done: true, value: undefined });
    assert.throws(() => conversation.getSnapshot(), ConversationHandleClosedError);
    assert.throws(
      () => conversation.input.enqueue(
        new UserMessageInputEvent({ text: "must-not-run" }),
      ),
      ConversationHandleClosedError,
    );
    assert.equal(commandService.calls.length, 0);

    await publisher.append(
      createOutputRequest({
        conversationId,
        eventId: "main-output-4",
        timestamp: "2026-08-01T00:00:04.000Z",
        text: "shared-services-remain-open",
      }),
    );
    const reopenedHandle = await factory.open(conversationId);
    const reopenedPage = await reopenedHandle.events.list({
      anchor: { from: "start" },
      limit: 10,
    });
    assert.deepEqual(
      reopenedPage.events.map((event) => event.id),
      ["main-input-1", "main-output-2", "main-input-3", "main-output-4"],
    );
    await reopenedHandle.close();

    await publisher.close();
    await subscriptionService.close();
    await hub.close();
    await store.close();

    const serializedLogs = JSON.stringify(logEntries);
    for (const forbidden of [
      secretText,
      "forbidden-close-failure-one",
      "forbidden-close-failure-two",
    ]) {
      assert.equal(serializedLogs.includes(forbidden), false);
    }
    for (const entry of logEntries) {
      assert.equal(Object.hasOwn(entry.fields, "payload"), false);
      assert.equal(Object.hasOwn(entry.fields, "message"), false);
      assert.equal(Object.hasOwn(entry.fields, "stack"), false);
      assert.equal(Object.hasOwn(entry.fields, "cause"), false);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const logEntries = [];
await testHandleLifecycle(logEntries);
await testSqliteReadOnlyPath(logEntries);

console.log("Task 2-B LocalConversation integration smoke passed");
