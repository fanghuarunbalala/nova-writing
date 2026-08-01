import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryConversationEventHub,
  JournalConversationEventSubscriptionService,
  PublishingConversationJournalService,
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

function createEventStack(store, logger) {
  const hub = new InMemoryConversationEventHub({ logger });
  return {
    hub,
    publisher: new PublishingConversationJournalService({
      journal: store.journal,
      hub,
      logger,
    }),
    subscriptions: new JournalConversationEventSubscriptionService({
      journal: store.journal,
      hub,
      logger,
      pageSize: 2,
    }),
  };
}

async function closeEventStack(stack, store) {
  await stack.publisher.close();
  await stack.subscriptions.close();
  await stack.hub.close();
  await store.close();
}

async function readEvent(subscription) {
  const result = await subscription.next();
  assert.equal(result.done, false);
  return result.value;
}

function assertLogsAreRedacted(entries, secretText) {
  const serialized = JSON.stringify(entries);
  assert.equal(serialized.includes(secretText), false);
  for (const entry of entries) {
    assert.equal(Object.hasOwn(entry.fields, "payload"), false);
    assert.equal(Object.hasOwn(entry.fields, "message"), false);
    assert.equal(Object.hasOwn(entry.fields, "stack"), false);
    assert.equal(Object.hasOwn(entry.fields, "cause"), false);
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-conversation-events-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const conversationId = "conversation-event-integration";
const secretText = "SMOKE_SECRET_EVENT_PAYLOAD";
const logEntries = [];
const logger = new CollectingLogger(logEntries);

const inputOne = createInputRequest({
  conversationId,
  eventId: "input-1",
  timestamp: "2026-08-01T00:00:00.000Z",
  text: secretText,
});
const outputTwo = createOutputRequest({
  conversationId,
  eventId: "output-2",
  timestamp: "2026-08-01T00:00:01.000Z",
  text: "assistant-history",
});
const inputThree = createInputRequest({
  conversationId,
  eventId: "input-3",
  timestamp: "2026-08-01T00:00:02.000Z",
  text: "live-during-catch-up",
});
const outputFour = createOutputRequest({
  conversationId,
  eventId: "output-4",
  timestamp: "2026-08-01T00:00:03.000Z",
  text: "live-after-catch-up",
});
const inputFive = createInputRequest({
  conversationId,
  eventId: "input-5",
  timestamp: "2026-08-01T00:00:04.000Z",
  text: "live-after-reopen",
});

try {
  await mkdir(workspaceRoot, { recursive: true });
  const locator = new NodeWorkspaceStoreLocator({ storageRoot });
  const location = await locator.resolve(workspaceRoot);

  const firstStore = await SqliteWorkspaceStore.open({ workspace: location, logger });
  await firstStore.conversations.createConversation({
    id: conversationId,
    workspaceId: location.workspaceId,
    agent: {
      agentType: "novel.main",
      definitionVersion: "1",
    },
  });
  const firstStack = createEventStack(firstStore, logger);

  const firstResult = await firstStack.publisher.append(inputOne);
  const secondResult = await firstStack.publisher.append(outputTwo);
  assert.equal(firstResult.livePublication.status, "published");
  assert.equal(secondResult.livePublication.status, "published");

  const fromStart = firstStack.subscriptions.subscribe({
    conversationId,
    start: { from: "start" },
    liveBufferCapacity: 8,
  });
  const thirdAppend = firstStack.publisher.append(inputThree);
  const firstDelivery = await readEvent(fromStart);
  const secondDelivery = await readEvent(fromStart);
  const thirdDelivery = await readEvent(fromStart);
  const thirdResult = await thirdAppend;

  assert.deepEqual(
    [firstDelivery.sequence, secondDelivery.sequence, thirdDelivery.sequence],
    [1, 2, 3],
  );
  assert.deepEqual(
    [firstDelivery.id, secondDelivery.id, thirdDelivery.id],
    ["input-1", "output-2", "input-3"],
  );
  assert.deepEqual(
    [firstDelivery.direction, secondDelivery.direction, thirdDelivery.direction],
    ["input", "output", "input"],
  );
  assert.equal(thirdResult.event.sequence, 3);

  const duplicate = await firstStack.publisher.append(inputThree);
  assert.deepEqual(duplicate.livePublication, {
    status: "skipped",
    reason: "duplicate",
  });
  assert.equal(await firstStore.journal.getHighWatermark(conversationId), 3);

  const fourthResult = await firstStack.publisher.append(outputFour);
  const fourthDelivery = await readEvent(fromStart);
  assert.equal(fourthResult.event.sequence, 4);
  assert.equal(fourthDelivery.id, "output-4");
  assert.equal(fourthDelivery.sequence, 4);
  assert.equal(await firstStore.journal.getHighWatermark(conversationId), 4);

  await closeEventStack(firstStack, firstStore);

  const reopenedStore = await SqliteWorkspaceStore.open({ workspace: location, logger });
  const replayPage = await reopenedStore.journal.list({
    conversationId,
    anchor: { from: "start" },
    limit: 10,
  });
  assert.equal(replayPage.highWatermark, 4);
  assert.deepEqual(
    replayPage.events.map((event) => [event.sequence, event.id, event.direction]),
    [
      [1, "input-1", "input"],
      [2, "output-2", "output"],
      [3, "input-3", "input"],
      [4, "output-4", "output"],
    ],
  );

  const reopenedStack = createEventStack(reopenedStore, logger);
  const afterTwo = reopenedStack.subscriptions.subscribe({
    conversationId,
    start: { afterSequence: 2 },
    liveBufferCapacity: 8,
  });
  const fifthAppend = reopenedStack.publisher.append(inputFive);
  const replayedThree = await readEvent(afterTwo);
  const replayedFour = await readEvent(afterTwo);
  const liveFive = await readEvent(afterTwo);
  const fifthResult = await fifthAppend;

  assert.deepEqual(
    [replayedThree.sequence, replayedFour.sequence, liveFive.sequence],
    [3, 4, 5],
  );
  assert.deepEqual(
    [replayedThree.id, replayedFour.id, liveFive.id],
    ["input-3", "output-4", "input-5"],
  );
  assert.equal(fifthResult.livePublication.status, "published");
  assert.equal(await reopenedStore.journal.getHighWatermark(conversationId), 5);

  await closeEventStack(reopenedStack, reopenedStore);
  assertLogsAreRedacted(logEntries, secretText);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Task 1D-F Conversation Event SQLite integration smoke passed");
