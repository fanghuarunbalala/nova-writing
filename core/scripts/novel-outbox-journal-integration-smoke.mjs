import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
  ConversationNovelLifecycleOutputPublisher,
  InMemoryConversationEventHub,
  NovelOutboxDispatcher,
  PublishingConversationJournalService,
  StorageConversationOutputEventPublisher,
  captureNovelLifecycleRecord,
  captureNovelTimestamp,
  createCoreEventSchemaRegistry,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelLifecycleRecordWriter,
  SqliteNovelOutboxStore,
  SqliteWorkspaceStore,
} from "../dist/node/index.js";

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }

  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }

  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }

  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

function lifecycleRecord({ eventId, novelId, conversationId, occurredAt }) {
  return captureNovelLifecycleRecord({
    recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
    eventId,
    eventType: NOVEL_LIFECYCLE_EVENT_TYPE.recoveryCompleted,
    novelId,
    conversationId,
    occurredAt: captureNovelTimestamp(occurredAt),
    payload: {
      scope: "draft",
      outcome: "verified",
      affectedCount: 1,
    },
  });
}

async function openJournalPipeline({ workspace, registry, logger }) {
  const workspaceStore = await SqliteWorkspaceStore.open({
    workspace,
    eventSchemaRegistry: registry,
    logger,
  });
  const hub = new InMemoryConversationEventHub({ logger });
  const journalService = new PublishingConversationJournalService({
    journal: workspaceStore.journal,
    hub,
    logger,
  });
  const outputPublisher = new StorageConversationOutputEventPublisher({
    eventSchemaRegistry: registry,
    journalService,
    logger,
  });
  return {
    workspaceStore,
    hub,
    journalService,
    lifecyclePublisher: new ConversationNovelLifecycleOutputPublisher(
      outputPublisher,
    ),
  };
}

async function closeJournalPipeline(pipeline) {
  if (pipeline === undefined) return;
  await pipeline.journalService.close();
  await pipeline.hub.close();
  await pipeline.workspaceStore.close();
}

async function listOutputEvents(workspaceStore, conversationId) {
  return (
    await workspaceStore.journal.list({
      conversationId,
      anchor: { from: "start" },
      direction: "output",
      limit: 100,
    })
  ).events;
}

function assertLogsAreRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false);
  }
  for (const entry of entries) {
    for (const field of [
      "path",
      "storeDir",
      "databasePath",
      "eventJson",
      "payload",
      "prompt",
      "config",
      "tool",
      "message",
      "stack",
      "cause",
      "stderr",
    ]) {
      assert.equal(Object.hasOwn(entry.fields, field), false);
    }
  }
}

const temporaryRoot = await mkdtemp(
  join(tmpdir(), "novel-outbox-journal-integration-"),
);
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const rootConversationId = "conversation-novel-root";
const childConversationId = "conversation-novel-subagent";
const logs = [];
const logger = new CollectingLogger(logs);
const registry = createCoreEventSchemaRegistry();

let canonicalStore;
let outboxStore;
let journalPipeline;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  const novelLocation = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({
    location: novelLocation,
    logger,
  });
  const metadata = await canonicalStore.getMetadata();
  const writer = new SqliteNovelLifecycleRecordWriter(
    novelLocation,
    metadata.novelId,
  );

  journalPipeline = await openJournalPipeline({ workspace, registry, logger });
  await journalPipeline.workspaceStore.conversations.createConversation({
    id: rootConversationId,
    workspaceId: workspace.workspaceId,
    agent: { agentType: "novel.main", definitionVersion: "1" },
  });
  await journalPipeline.workspaceStore.conversations.createConversation({
    id: childConversationId,
    workspaceId: workspace.workspaceId,
    parentConversationId: rootConversationId,
    agent: { agentType: "novel.subagent", definitionVersion: "1" },
  });

  const rootFirst = lifecycleRecord({
    eventId: "novel-journal:root:first",
    novelId: metadata.novelId,
    conversationId: rootConversationId,
    occurredAt: "2026-08-02T15:00:00.000Z",
  });
  const childFirst = lifecycleRecord({
    eventId: "novel-journal:child:first",
    novelId: metadata.novelId,
    conversationId: childConversationId,
    occurredAt: "2026-08-02T15:01:00.000Z",
  });
  const rootSecond = lifecycleRecord({
    eventId: "novel-journal:root:second",
    novelId: metadata.novelId,
    conversationId: rootConversationId,
    occurredAt: "2026-08-02T15:02:00.000Z",
  });

  await writer.recordCanonical(rootSecond);
  await writer.recordCanonical(childFirst);
  assert.equal(await writer.recordCanonical(rootFirst), "recorded");
  assert.equal(await writer.recordCanonical(rootFirst), "duplicate");

  outboxStore = await SqliteNovelOutboxStore.openCanonical({
    location: novelLocation,
    novelId: metadata.novelId,
    logger,
  });
  const dispatcher = new NovelOutboxDispatcher({
    store: outboxStore,
    publisher: journalPipeline.lifecyclePublisher,
    pageSize: 2,
    logger,
  });
  assert.deepEqual(await dispatcher.dispatchPending(), {
    source: { kind: "canonical" },
    attemptedCount: 3,
    recordedCount: 3,
    duplicateCount: 0,
    alreadyPublishedCount: 0,
  });

  const rootEvents = await listOutputEvents(
    journalPipeline.workspaceStore,
    rootConversationId,
  );
  const childEvents = await listOutputEvents(
    journalPipeline.workspaceStore,
    childConversationId,
  );
  assert.deepEqual(
    rootEvents.map((event) => event.id),
    [rootFirst.eventId, rootSecond.eventId],
  );
  assert.deepEqual(
    childEvents.map((event) => event.id),
    [childFirst.eventId],
  );
  assert.equal(
    rootEvents.every((event) => event.conversationId === rootConversationId),
    true,
  );
  assert.equal(
    childEvents.every((event) => event.conversationId === childConversationId),
    true,
  );
  assert.deepEqual(
    logs
      .filter((entry) => entry.event === "conversation.output.recorded")
      .map((entry) => entry.fields.outputEventId),
    [rootFirst.eventId, childFirst.eventId, rootSecond.eventId],
  );

  const crashWindowRecord = lifecycleRecord({
    eventId: "novel-journal:child:crash-window",
    novelId: metadata.novelId,
    conversationId: childConversationId,
    occurredAt: "2026-08-02T15:03:00.000Z",
  });
  await writer.recordCanonical(crashWindowRecord);
  const directReceipt = await journalPipeline.lifecyclePublisher.publish(
    crashWindowRecord,
  );
  assert.equal(directReceipt.status, "recorded");

  await outboxStore.close();
  outboxStore = undefined;
  await closeJournalPipeline(journalPipeline);
  journalPipeline = undefined;
  await canonicalStore.close();
  canonicalStore = undefined;

  canonicalStore = await SqliteNovelCanonicalStore.open({
    location: novelLocation,
    expectedNovelId: metadata.novelId,
    logger,
  });
  journalPipeline = await openJournalPipeline({ workspace, registry, logger });
  outboxStore = await SqliteNovelOutboxStore.openCanonical({
    location: novelLocation,
    novelId: metadata.novelId,
    logger,
  });
  const recoveredDispatcher = new NovelOutboxDispatcher({
    store: outboxStore,
    publisher: journalPipeline.lifecyclePublisher,
    logger,
  });
  const recovered = await recoveredDispatcher.dispatchPending();
  assert.equal(recovered.attemptedCount, 1);
  assert.equal(recovered.recordedCount, 0);
  assert.equal(recovered.duplicateCount, 1);
  assert.equal(recovered.alreadyPublishedCount, 0);

  const recoveredChildEvents = await listOutputEvents(
    journalPipeline.workspaceStore,
    childConversationId,
  );
  assert.deepEqual(
    recoveredChildEvents.map((event) => event.id),
    [childFirst.eventId, crashWindowRecord.eventId],
  );
  assert.equal(
    recoveredChildEvents.filter(
      (event) => event.id === crashWindowRecord.eventId,
    ).length,
    1,
  );
  assert.deepEqual(await recoveredDispatcher.dispatchPending(), {
    source: { kind: "canonical" },
    attemptedCount: 0,
    recordedCount: 0,
    duplicateCount: 0,
    alreadyPublishedCount: 0,
  });

  assertLogsAreRedacted(logs, [
    temporaryRoot,
    workspaceRoot,
    storageRoot,
    workspace.storeDir,
    workspace.databasePath,
    novelLocation.canonicalDatabasePath,
    JSON.stringify(crashWindowRecord),
  ]);
} finally {
  await outboxStore?.close();
  await closeJournalPipeline(journalPipeline);
  await canonicalStore?.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("novel outbox journal integration smoke passed");
