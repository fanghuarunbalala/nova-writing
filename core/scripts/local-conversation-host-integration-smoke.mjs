import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConversationHandleClosedError,
  CoreConversationHostControlDispatcher,
  CoreConversationInputRoutePolicy,
  InMemoryConversationEventHub,
  JournalConversationEventSubscriptionService,
  LocalConversationFactory,
  ManagedConversationHost,
  PublishingConversationJournalService,
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
    const value = new Date(Date.UTC(2026, 7, 1, 4, 0, 0, this.offset));
    this.offset += 1;
    return value.toISOString();
  }
}

class RuntimeInstanceIdGenerator {
  generate() {
    return "rt_local_conversation_host";
  }
}

class LocalIntegrationRuntimeHandle {
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
        exitedAt: "2026-08-01T04:30:00.000Z",
        reason: request.reason,
      }),
    );
  }

  waitForExit() {
    return this.exit.promise;
  }
}

class LocalIntegrationPlacement {
  constructor() {
    this.bootstraps = [];
    this.handles = [];
  }

  async activate(bootstrap) {
    this.bootstraps.push(bootstrap);
    const handle = new LocalIntegrationRuntimeHandle(
      bootstrap.conversation.metadata.id,
      bootstrap.runtimeInstanceId,
    );
    this.handles.push(handle);
    return handle;
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
    for (const field of [
      "payload",
      "config",
      "prompt",
      "tool",
      "path",
      "message",
      "stack",
      "cause",
    ]) {
      assert.equal(Object.hasOwn(entry.fields, field), false);
    }
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-local-host-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const conversationId = "conversation-local-host";
const secretText = "FORBIDDEN_LOCAL_HANDLE_NOVEL_TEXT";
const logEntries = [];
const logger = new CollectingLogger(logEntries);

let store;
let hub;
let journalService;
let subscriptionService;
let host;
let firstConversation;
let secondConversation;

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
  journalService = new PublishingConversationJournalService({
    journal: store.journal,
    hub,
    logger,
  });
  subscriptionService = new JournalConversationEventSubscriptionService({
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
  const outputPublisher = new StorageConversationOutputEventPublisher({
    eventSchemaRegistry: registry,
    journalService,
    logger,
  });
  const clock = new IncrementingClock();
  const placement = new LocalIntegrationPlacement();
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
    runtimeInstanceIdGenerator: new RuntimeInstanceIdGenerator(),
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
  const factory = new LocalConversationFactory({
    queryService,
    commandService,
    runtimePresenceReader: host,
    logger,
  });

  firstConversation = await factory.open(conversationId);
  assert.equal(placement.handles.length, 0);
  assert.equal((await firstConversation.getRuntimePresence()).state, "offline");
  const firstSubscription = firstConversation.events.subscribe({
    start: { from: "start" },
    liveBufferCapacity: 16,
  });

  const userReceipt = await firstConversation.input.enqueue(
    new UserMessageInputEvent({
      id: "input-local-user-1",
      timestamp: "2026-08-01T04:00:00.000Z",
      text: secretText,
    }),
  );
  assert.equal(userReceipt.sequence, 1);
  await waitUntil(
    () => placement.handles[0]?.inputs.length === 1,
    "LocalConversation user dispatch",
  );
  assert.equal((await firstConversation.getRuntimePresence()).state, "online");

  const firstObserved = [];
  for (let index = 0; index < 3; index += 1) {
    const next = await firstSubscription.next();
    assert.equal(next.done, false);
    firstObserved.push(next.value);
  }
  assert.deepEqual(
    firstObserved.map((event) => [event.sequence, event.eventType]),
    [
      [1, "user.message"],
      [2, "system.runtime.presence.changed"],
      [3, "system.runtime.presence.changed"],
    ],
  );

  const firstHistory = await firstConversation.events.list({
    anchor: { from: "start" },
    limit: 10,
  });
  assert.equal(firstHistory.highWatermark, 3);
  assert.equal(firstHistory.events.length, 3);

  await firstConversation.close();
  firstConversation = undefined;
  assert.equal((await firstSubscription.next()).done, true);
  assert.equal((await host.getRuntimePresence(conversationId)).state, "online");
  assert.equal(placement.handles.length, 1);

  secondConversation = await factory.open(conversationId);
  assert.equal((await secondConversation.getRuntimePresence()).state, "online");
  assert.equal(placement.handles.length, 1);
  const secondSubscription = secondConversation.events.subscribe({
    start: { afterSequence: 3 },
    liveBufferCapacity: 16,
  });
  const stopReceipt = await secondConversation.input.enqueue(
    new StopInputEvent({
      id: "input-local-stop-2",
      timestamp: "2026-08-01T04:00:10.000Z",
    }),
  );
  assert.equal(stopReceipt.sequence, 4);
  await waitUntil(
    () => placement.handles[0].inputs.length === 2,
    "LocalConversation Stop routing",
  );
  const secondObserved = [];
  for (let index = 0; index < 2; index += 1) {
    const next = await secondSubscription.next();
    assert.equal(next.done, false);
    secondObserved.push(next.value);
  }
  assert.deepEqual(
    secondObserved.map((event) => [event.sequence, event.eventType]),
    [
      [4, "system.stop"],
      [5, "system.input.routed"],
    ],
  );

  await secondConversation.close();
  assert.equal((await secondSubscription.next()).done, true);
  assert.throws(
    () => secondConversation.events.list({ anchor: { from: "start" } }),
    ConversationHandleClosedError,
  );
  assert.throws(
    () => secondConversation.input.enqueue(new StopInputEvent()),
    ConversationHandleClosedError,
  );
  secondConversation = undefined;

  assert.equal((await host.getRuntimePresence(conversationId)).state, "online");
  const sharedHistory = await queryService.listEvents(conversationId, {
    anchor: { from: "start" },
    limit: 10,
  });
  assert.equal(sharedHistory.highWatermark, 5);
  assert.equal(sharedHistory.events.length, 5);
  assert.equal(placement.handles[0].shutdownRequests.length, 0);

  await host.close();
  host = undefined;
  assert.equal(placement.handles[0].shutdownRequests.length, 1);
  await subscriptionService.close();
  subscriptionService = undefined;
  await journalService.close();
  journalService = undefined;
  await hub.close();
  hub = undefined;
  await store.close();
  store = undefined;

  assertLogsAreRedacted(logEntries, [
    secretText,
    workspaceRoot,
    storageRoot,
    location.storeDir,
    location.databasePath,
  ]);
} finally {
  if (firstConversation) await firstConversation.close();
  if (secondConversation) await secondConversation.close();
  if (host) await host.close();
  if (subscriptionService) await subscriptionService.close();
  if (journalService) await journalService.close();
  if (hub) await hub.close();
  if (store) await store.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("LocalConversation Host integration smoke passed");
