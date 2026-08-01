import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  CoreConversationHostControlDispatcher,
  CoreConversationInputRoutePolicy,
  InMemoryConversationEventHub,
  JournalConversationEventSubscriptionService,
  ManagedConversationHost,
  PublishingConversationJournalService,
  ReloadConfigInputEvent,
  StopInputEvent,
  StorageConversationCommandService,
  StorageConversationOutputEventPublisher,
  StorageConversationQueryService,
  StorageConversationRuntimeBootstrapFactory,
  UserMessageInputEvent,
  createCoreEventSchemaRegistry,
} from "../dist/index.js";
import {
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
} from "../dist/node/index.js";

class IncrementingClock {
  constructor() {
    this.offset = 0;
  }

  now() {
    const value = new Date(Date.UTC(2026, 7, 1, 2, 0, 0, this.offset));
    this.offset += 1;
    return value.toISOString();
  }
}

class SequentialRuntimeInstanceIdGenerator {
  constructor() {
    this.nextId = 1;
  }

  generate() {
    return `rt_sqlite_host_${this.nextId++}`;
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
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

class IntegrationRuntimeHandle {
  constructor(conversationId, runtimeInstanceId) {
    this.conversationId = conversationId;
    this.runtimeInstanceId = runtimeInstanceId;
    this.inputs = [];
    this.shutdownRequests = [];
    this.exit = deferred();
    this.exited = false;
  }

  async dispatchInput(input) {
    this.inputs.push(input);
  }

  async shutdown(request) {
    this.shutdownRequests.push(request);
    if (this.exited) return;
    this.exited = true;
    this.exit.resolve(
      Object.freeze({
        kind: "stopped",
        exitedAt: "2026-08-01T02:30:00.000Z",
        reason: request.reason,
      }),
    );
  }

  waitForExit() {
    return this.exit.promise;
  }
}

class IntegrationRuntimePlacement {
  constructor() {
    this.bootstraps = [];
    this.handles = [];
  }

  async activate(bootstrap) {
    this.bootstraps.push(bootstrap);
    const handle = new IntegrationRuntimeHandle(
      bootstrap.conversation.metadata.id,
      bootstrap.runtimeInstanceId,
    );
    this.handles.push(handle);
    return handle;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate, label) {
  const deadline = Date.now() + 3_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function assertLogsAreRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false);
  }
  for (const entry of entries) {
    for (const forbiddenField of [
      "payload",
      "config",
      "prompt",
      "tool",
      "path",
      "message",
      "stack",
      "cause",
    ]) {
      assert.equal(Object.hasOwn(entry.fields, forbiddenField), false);
    }
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-host-sqlite-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const conversationId = "conversation-host-sqlite";
const secretNovelText = "FORBIDDEN_SQLITE_HOST_NOVEL_TEXT";
const secretLocale = "FORBIDDEN_RELOAD_LOCALE";
const logEntries = [];
const logger = new CollectingLogger(logEntries);

let store;
let hub;
let journalService;
let subscriptionService;
let liveSubscription;
let host;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const location = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  const registry = createCoreEventSchemaRegistry();
  store = await SqliteWorkspaceStore.open({
    workspace: location,
    eventSchemaRegistry: registry,
    logger,
  });
  await store.conversations.createConversation({
    id: conversationId,
    workspaceId: location.workspaceId,
    agent: {
      agentType: "novel.main",
      definitionVersion: "1",
    },
  });

  hub = new InMemoryConversationEventHub({ logger });
  liveSubscription = hub.subscribe({ conversationId });
  journalService = new PublishingConversationJournalService({
    journal: store.journal,
    hub,
    logger,
  });
  subscriptionService = new JournalConversationEventSubscriptionService({
    journal: store.journal,
    hub,
    logger,
  });
  const queryService = new StorageConversationQueryService({
    catalog: store.conversations,
    journal: store.journal,
    subscriptions: subscriptionService,
    logger,
  });
  const outputPublisher = new StorageConversationOutputEventPublisher({
    eventSchemaRegistry: registry,
    journalService,
    logger,
  });
  const clock = new IncrementingClock();
  const placement = new IntegrationRuntimePlacement();
  const bootstrapFactory = new StorageConversationRuntimeBootstrapFactory({
    snapshotReader: queryService,
    journal: store.journal,
    workspace: location,
    logger,
  });
  const controlDispatcher = new CoreConversationHostControlDispatcher({
    outputPublisher,
    clock,
    logger,
  });
  host = new ManagedConversationHost({
    snapshotReader: queryService,
    bootstrapFactory,
    placement,
    controlDispatcher,
    outputPublisher,
    clock,
    runtimeInstanceIdGenerator: new SequentialRuntimeInstanceIdGenerator(),
    logger,
  });
  const commandService = new StorageConversationCommandService({
    metadataStore: store.conversations,
    journalService,
    eventSchemaRegistry: registry,
    routePolicy: new CoreConversationInputRoutePolicy(),
    acceptedInputNotifier: host,
    logger,
  });

  const userReceipt = await commandService.enqueue(
    conversationId,
    new UserMessageInputEvent({
      id: "input-user-1",
      timestamp: "2026-08-01T02:00:00.000Z",
      correlationId: "correlation-user-1",
      text: secretNovelText,
    }),
  );
  assert.equal(userReceipt.sequence, 1);
  await waitUntil(
    () => placement.handles[0]?.inputs.length === 1,
    "user Runtime dispatch",
  );
  assert.equal(placement.bootstraps.length, 1);
  assert.equal(placement.bootstraps[0].activation.reason, "accepted_input");
  assert.equal(placement.bootstraps[0].activation.input.sequence, 1);
  assert.equal(placement.bootstraps[0].journal.highWatermark, 2);
  assert.equal(placement.handles[0].inputs[0].sequence, 1);

  const onlineStop = new StopInputEvent({
    id: "input-stop-online-2",
    timestamp: "2026-08-01T02:00:10.000Z",
    runId: "run-online-stop",
  });
  const onlineStopReceipt = await commandService.enqueue(
    conversationId,
    onlineStop,
  );
  assert.equal(onlineStopReceipt.sequence, 4);
  await waitUntil(
    () => placement.handles[0].inputs.length === 2,
    "online Stop routing",
  );
  await waitUntil(
    async () => (await store.journal.getHighWatermark(conversationId)) === 5,
    "online Stop routed Output",
  );
  assert.equal(placement.handles[0].inputs[1].sequence, 4);
  assert.equal(placement.handles[0].inputs[1].eventType, "system.stop");

  const duplicateStopReceipt = await commandService.enqueue(
    conversationId,
    onlineStop,
  );
  assert.equal(duplicateStopReceipt.status, "duplicate");
  assert.equal(duplicateStopReceipt.sequence, 4);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(await store.journal.getHighWatermark(conversationId), 5);
  assert.equal(placement.handles[0].inputs.length, 2);

  const shutdown = await host.shutdownRuntime({
    conversationId,
    reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
  });
  assert.equal(shutdown.status, "stopped");
  assert.equal(shutdown.presence.state, "offline");
  assert.equal(await store.journal.getHighWatermark(conversationId), 7);

  const reloadReceipt = await commandService.enqueue(
    conversationId,
    new ReloadConfigInputEvent({
      id: "input-reload-offline-3",
      timestamp: "2026-08-01T02:00:20.000Z",
      config: { runtime: "agent", locale: secretLocale },
    }),
  );
  assert.equal(reloadReceipt.sequence, 8);
  await waitUntil(
    async () => (await store.journal.getHighWatermark(conversationId)) === 9,
    "offline ReloadConfig routed Output",
  );
  assert.equal(placement.handles.length, 1);

  const offlineStopReceipt = await commandService.enqueue(
    conversationId,
    new StopInputEvent({
      id: "input-stop-offline-4",
      timestamp: "2026-08-01T02:00:30.000Z",
    }),
  );
  assert.equal(offlineStopReceipt.sequence, 10);
  await waitUntil(
    async () => (await store.journal.getHighWatermark(conversationId)) === 11,
    "offline Stop routed Output",
  );
  assert.equal(placement.handles.length, 1);

  const liveEvents = [];
  for (let index = 0; index < 11; index += 1) {
    const next = await liveSubscription.next();
    assert.equal(next.done, false);
    liveEvents.push(next.value);
  }
  assert.deepEqual(
    liveEvents.map((event) => event.sequence),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );

  const page = await store.journal.list({
    conversationId,
    anchor: { from: "start" },
    limit: 20,
  });
  assert.deepEqual(
    page.events.map((event) => ({
      sequence: event.sequence,
      direction: event.direction,
      eventType: event.eventType,
      ...(event.payload.reason !== undefined
        ? { reason: event.payload.reason }
        : {}),
      ...(event.payload.outcome !== undefined
        ? { outcome: event.payload.outcome }
        : {}),
    })),
    [
      { sequence: 1, direction: "input", eventType: "user.message" },
      {
        sequence: 2,
        direction: "output",
        eventType: "system.runtime.presence.changed",
        reason: "accepted_input",
      },
      {
        sequence: 3,
        direction: "output",
        eventType: "system.runtime.presence.changed",
        reason: "activation_succeeded",
      },
      { sequence: 4, direction: "input", eventType: "system.stop" },
      {
        sequence: 5,
        direction: "output",
        eventType: "system.input.routed",
        outcome: "runtime_notified",
      },
      {
        sequence: 6,
        direction: "output",
        eventType: "system.runtime.presence.changed",
        reason: "explicit_shutdown",
      },
      {
        sequence: 7,
        direction: "output",
        eventType: "system.runtime.presence.changed",
        reason: "runtime_stopped",
      },
      {
        sequence: 8,
        direction: "input",
        eventType: "command.config.reload",
      },
      {
        sequence: 9,
        direction: "output",
        eventType: "system.input.routed",
        outcome: "deferred",
      },
      { sequence: 10, direction: "input", eventType: "system.stop" },
      {
        sequence: 11,
        direction: "output",
        eventType: "system.input.routed",
        outcome: "no_runtime",
      },
    ],
  );

  await host.close();
  host = undefined;
  await liveSubscription.close();
  liveSubscription = undefined;
  await subscriptionService.close();
  subscriptionService = undefined;
  await journalService.close();
  journalService = undefined;
  await hub.close();
  hub = undefined;
  await store.close();
  store = undefined;

  const reopenedStore = await SqliteWorkspaceStore.open({
    workspace: location,
    eventSchemaRegistry: registry,
    logger,
  });
  try {
    const replay = await reopenedStore.journal.list({
      conversationId,
      anchor: { from: "start" },
      limit: 20,
    });
    assert.equal(replay.highWatermark, 11);
    assert.equal(replay.events.length, 11);
    assert.equal(replay.events[4].payload.outcome, "runtime_notified");
    assert.equal(replay.events[8].payload.outcome, "deferred");
    assert.equal(replay.events[10].payload.outcome, "no_runtime");
  } finally {
    await reopenedStore.close();
  }

  assertLogsAreRedacted(logEntries, [
    secretNovelText,
    secretLocale,
    workspaceRoot,
    storageRoot,
    location.storeDir,
    location.databasePath,
  ]);
} finally {
  if (host) await host.close();
  if (liveSubscription) await liveSubscription.close();
  if (subscriptionService) await subscriptionService.close();
  if (journalService) await journalService.close();
  if (hub) await hub.close();
  if (store) await store.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("conversation host SQLite integration smoke passed");
