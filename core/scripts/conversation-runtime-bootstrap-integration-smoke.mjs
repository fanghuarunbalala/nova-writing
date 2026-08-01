import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CONVERSATION_RUNTIME_ACTIVATION_REASON,
  ConversationNotFoundError,
  ConversationRuntimeBootstrapConversationNotActiveError,
  ConversationRuntimeBootstrapHighWatermarkError,
  ConversationRuntimeBootstrapInputMismatchError,
  ConversationRuntimeBootstrapInputNotFoundError,
  ConversationRuntimeBootstrapValidationError,
  ConversationRuntimeBootstrapWorkspaceMismatchError,
  InMemoryConversationEventHub,
  JournalConversationEventSubscriptionService,
  PublishingConversationJournalService,
  StorageConversationQueryService,
  StorageConversationRuntimeBootstrapFactory,
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

function setConversationStatus(databasePath, conversationId, status) {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const result = database
      .prepare("UPDATE conversations SET status = ? WHERE id = ?")
      .run(status, conversationId);
    assert.equal(Number(result.changes), 1);
  } finally {
    database.close();
  }
}

function acceptedInputRequest(input, overrides = {}) {
  return {
    conversationId: input.conversationId,
    runtimeInstanceId: "runtime-bootstrap-accepted",
    activatedAt: "2026-08-01T00:00:02.000Z",
    activation: {
      reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput,
      input: { ...input, ...(overrides.input ?? {}) },
    },
    ...overrides,
  };
}

function assertRejectedAs(ErrorType) {
  return (error) => error instanceof ErrorType;
}

function assertDeepFrozen(bootstrap) {
  assert.equal(Object.isFrozen(bootstrap), true);
  assert.equal(Object.isFrozen(bootstrap.conversation), true);
  assert.equal(Object.isFrozen(bootstrap.conversation.metadata), true);
  assert.equal(Object.isFrozen(bootstrap.conversation.activeAgentBinding), true);
  assert.equal(Object.isFrozen(bootstrap.workspace), true);
  assert.equal(Object.isFrozen(bootstrap.activation), true);
  if (bootstrap.activation.reason === "accepted_input") {
    assert.equal(Object.isFrozen(bootstrap.activation.input), true);
  }
  assert.equal(Object.isFrozen(bootstrap.journal), true);
}

function assertLogsAreRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false);
  }
  for (const entry of entries) {
    assert.equal(Object.hasOwn(entry.fields, "payload"), false);
    assert.equal(Object.hasOwn(entry.fields, "workdir"), false);
    assert.equal(Object.hasOwn(entry.fields, "storeDir"), false);
    assert.equal(Object.hasOwn(entry.fields, "databasePath"), false);
    assert.equal(Object.hasOwn(entry.fields, "message"), false);
    assert.equal(Object.hasOwn(entry.fields, "stack"), false);
    assert.equal(Object.hasOwn(entry.fields, "cause"), false);
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-runtime-bootstrap-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const conversationId = "conversation-runtime-bootstrap";
const secretText = "FORBIDDEN_BOOTSTRAP_NOVEL_TEXT";
const logEntries = [];
const logger = new CollectingLogger(logEntries);

let store;
let publisher;
let subscriptions;
let hub;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const location = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  store = await SqliteWorkspaceStore.open({ workspace: location, logger });
  await store.conversations.createConversation({
    id: conversationId,
    workspaceId: location.workspaceId,
    agent: {
      agentType: "novel.main",
      definitionVersion: "1",
      manifestDigest: "manifest-bootstrap-1",
    },
  });

  hub = new InMemoryConversationEventHub({ logger });
  publisher = new PublishingConversationJournalService({
    journal: store.journal,
    hub,
    logger,
  });
  subscriptions = new JournalConversationEventSubscriptionService({
    journal: store.journal,
    hub,
    logger,
  });
  const queryService = new StorageConversationQueryService({
    catalog: store.conversations,
    journal: store.journal,
    subscriptions,
    logger,
  });

  const inputEvent = new UserMessageInputEvent({
    conversationId,
    id: "input-runtime-bootstrap-1",
    timestamp: "2026-08-01T00:00:00.000Z",
    correlationId: "correlation-runtime-bootstrap",
    runId: "run-runtime-bootstrap",
    turnId: "turn-runtime-bootstrap",
    text: secretText,
  });
  const inputAppend = await publisher.append({
    direction: "input",
    snapshot: inputEvent.getSnapshot(),
  });
  assert.equal(inputAppend.receipt.sequence, 1);
  await publisher.append({
    direction: "output",
    snapshot: {
      id: "output-runtime-bootstrap-2",
      conversationId,
      eventType: "agent.message",
      schemaVersion: 1,
      timestamp: "2026-08-01T00:00:01.000Z",
      payload: { text: "assistant output must not become activation input" },
    },
  });

  const factory = new StorageConversationRuntimeBootstrapFactory({
    snapshotReader: queryService,
    journal: store.journal,
    workspace: location,
    logger,
  });
  const inputReference = {
    conversationId,
    inputEventId: inputEvent.id,
    eventType: inputEvent.getEventType(),
    sequence: inputAppend.receipt.sequence,
    correlationId: inputEvent.correlationId,
    runId: inputEvent.runId,
    turnId: inputEvent.turnId,
  };

  const bootstrap = await factory.create(acceptedInputRequest(inputReference));
  assert.equal(bootstrap.schemaVersion, 1);
  assert.equal(bootstrap.runtimeInstanceId, "runtime-bootstrap-accepted");
  assert.equal(bootstrap.activatedAt, "2026-08-01T00:00:02.000Z");
  assert.equal(bootstrap.conversation.metadata.id, conversationId);
  assert.equal(bootstrap.conversation.activeAgentBinding.agentType, "novel.main");
  assert.equal(bootstrap.conversation.activeAgentBinding.definitionVersion, "1");
  assert.equal(bootstrap.workspace.workspaceId, location.workspaceId);
  assert.equal(bootstrap.workspace.workdir, location.workspaceRoot);
  assert.equal(bootstrap.journal.highWatermark, 2);
  assert.deepEqual(bootstrap.activation.input, inputReference);
  assertDeepFrozen(bootstrap);

  const serializedBootstrap = JSON.stringify(bootstrap);
  assert.equal(serializedBootstrap.includes(location.storeDir), false);
  assert.equal(serializedBootstrap.includes(location.storeDirName), false);
  assert.equal(serializedBootstrap.includes(location.databasePath), false);
  assert.equal(serializedBootstrap.includes(secretText), false);

  const restoreBootstrap = await factory.create({
    conversationId,
    runtimeInstanceId: "runtime-bootstrap-restore",
    activatedAt: "2026-08-01T00:00:03.000Z",
    activation: {
      reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
    },
  });
  assert.equal(restoreBootstrap.activation.reason, "explicit_restore");
  assert.equal(Object.hasOwn(restoreBootstrap.activation, "input"), false);

  const recoveryBootstrap = await factory.create({
    conversationId,
    runtimeInstanceId: "runtime-bootstrap-recovery",
    activatedAt: "2026-08-01T00:00:04.000Z",
    activation: {
      reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.crashRecovery,
    },
  });
  assert.equal(recoveryBootstrap.activation.reason, "crash_recovery");

  const mutableSnapshot = {
    metadata: { ...bootstrap.conversation.metadata, lastJournalSequence: 1 },
    activeAgentBinding: { ...bootstrap.conversation.activeAgentBinding },
  };
  const staleSnapshotFactory = new StorageConversationRuntimeBootstrapFactory({
    snapshotReader: { getSnapshot: async () => mutableSnapshot },
    journal: store.journal,
    workspace: location,
    logger,
  });
  const staleSnapshotBootstrap = await staleSnapshotFactory.create({
    conversationId,
    runtimeInstanceId: "runtime-bootstrap-stale-snapshot",
    activatedAt: "2026-08-01T00:00:05.000Z",
    activation: {
      reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
    },
  });
  assert.equal(staleSnapshotBootstrap.conversation.metadata.lastJournalSequence, 1);
  assert.equal(staleSnapshotBootstrap.journal.highWatermark, 2);
  mutableSnapshot.metadata.status = "archived";
  mutableSnapshot.activeAgentBinding.agentType = "mutated.agent";
  assert.equal(staleSnapshotBootstrap.conversation.metadata.status, "active");
  assert.equal(staleSnapshotBootstrap.conversation.activeAgentBinding.agentType, "novel.main");

  await assert.rejects(
    factory.create({
      conversationId: "missing-conversation",
      runtimeInstanceId: "runtime-bootstrap-missing",
      activatedAt: "2026-08-01T00:00:06.000Z",
      activation: { reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore },
    }),
    assertRejectedAs(ConversationNotFoundError),
  );
  await assert.rejects(
    factory.create({
      conversationId,
      runtimeInstanceId: "runtime-bootstrap-invalid-time",
      activatedAt: "not-a-time",
      activation: { reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore },
    }),
    assertRejectedAs(ConversationRuntimeBootstrapValidationError),
  );
  await assert.rejects(
    factory.create(acceptedInputRequest(inputReference, {
      input: { sequence: 999 },
      runtimeInstanceId: "runtime-bootstrap-input-missing",
    })),
    assertRejectedAs(ConversationRuntimeBootstrapInputNotFoundError),
  );
  await assert.rejects(
    factory.create(acceptedInputRequest(inputReference, {
      input: { inputEventId: "wrong-input-id" },
      runtimeInstanceId: "runtime-bootstrap-input-id-mismatch",
    })),
    assertRejectedAs(ConversationRuntimeBootstrapInputMismatchError),
  );
  await assert.rejects(
    factory.create(acceptedInputRequest(inputReference, {
      input: { eventType: "context.clear" },
      runtimeInstanceId: "runtime-bootstrap-input-type-mismatch",
    })),
    assertRejectedAs(ConversationRuntimeBootstrapInputMismatchError),
  );
  await assert.rejects(
    factory.create(acceptedInputRequest(inputReference, {
      input: { correlationId: "wrong-correlation" },
      runtimeInstanceId: "runtime-bootstrap-correlation-mismatch",
    })),
    assertRejectedAs(ConversationRuntimeBootstrapInputMismatchError),
  );
  await assert.rejects(
    factory.create(acceptedInputRequest(inputReference, {
      input: { sequence: 2, inputEventId: "output-runtime-bootstrap-2", eventType: "agent.message", correlationId: undefined, runId: undefined, turnId: undefined },
      runtimeInstanceId: "runtime-bootstrap-output-mismatch",
    })),
    assertRejectedAs(ConversationRuntimeBootstrapInputMismatchError),
  );
  await assert.rejects(
    factory.create(acceptedInputRequest(inputReference, {
      input: { conversationId: "another-conversation" },
      runtimeInstanceId: "runtime-bootstrap-cross-conversation",
    })),
    assertRejectedAs(ConversationRuntimeBootstrapInputMismatchError),
  );

  const wrongWorkspaceFactory = new StorageConversationRuntimeBootstrapFactory({
    snapshotReader: queryService,
    journal: store.journal,
    workspace: {
      ...location,
      workspaceId: "wrong-workspace",
      workspaceRoot: "/wrong/workspace",
    },
    logger,
  });
  await assert.rejects(
    wrongWorkspaceFactory.create({
      conversationId,
      runtimeInstanceId: "runtime-bootstrap-workspace-mismatch",
      activatedAt: "2026-08-01T00:00:07.000Z",
      activation: { reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore },
    }),
    assertRejectedAs(ConversationRuntimeBootstrapWorkspaceMismatchError),
  );

  const invalidHighWatermarkFactory = new StorageConversationRuntimeBootstrapFactory({
    snapshotReader: queryService,
    journal: {
      ...store.journal,
      getHighWatermark: async () => -1,
      getBySequence: store.journal.getBySequence.bind(store.journal),
      getByEventId: store.journal.getByEventId.bind(store.journal),
      list: store.journal.list.bind(store.journal),
    },
    workspace: location,
    logger,
  });
  await assert.rejects(
    invalidHighWatermarkFactory.create({
      conversationId,
      runtimeInstanceId: "runtime-bootstrap-invalid-watermark",
      activatedAt: "2026-08-01T00:00:08.000Z",
      activation: { reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore },
    }),
    assertRejectedAs(ConversationRuntimeBootstrapHighWatermarkError),
  );

  setConversationStatus(location.databasePath, conversationId, "archived");
  await assert.rejects(
    factory.create({
      conversationId,
      runtimeInstanceId: "runtime-bootstrap-archived",
      activatedAt: "2026-08-01T00:00:09.000Z",
      activation: { reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore },
    }),
    assertRejectedAs(ConversationRuntimeBootstrapConversationNotActiveError),
  );
  setConversationStatus(location.databasePath, conversationId, "disposed");
  await assert.rejects(
    factory.create({
      conversationId,
      runtimeInstanceId: "runtime-bootstrap-disposed",
      activatedAt: "2026-08-01T00:00:10.000Z",
      activation: { reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.crashRecovery },
    }),
    assertRejectedAs(ConversationRuntimeBootstrapConversationNotActiveError),
  );

  assert.ok(
    logEntries.some(
      (entry) => entry.event === "conversation.runtime_bootstrap.created",
    ),
  );
  assert.ok(
    logEntries.some(
      (entry) => entry.event === "conversation.runtime_bootstrap.rejected",
    ),
  );
  assertLogsAreRedacted(logEntries, [
    secretText,
    location.workspaceRoot,
    location.storeDir,
    location.databasePath,
  ]);
} finally {
  if (publisher !== undefined) await publisher.close().catch(() => undefined);
  if (subscriptions !== undefined) await subscriptions.close().catch(() => undefined);
  if (hub !== undefined) await hub.close().catch(() => undefined);
  if (store !== undefined) await store.close().catch(() => undefined);
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Task 2D-B Runtime Bootstrap integration smoke passed");
