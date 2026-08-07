import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import {
  AgentAssistantMessageCompletedOutputEvent,
  CoreConversationRuntimeMessageProjector,
  INPUT_EVENT_TYPE,
  UserMessageInputEvent,
  createCoreRuntimeMessageSchemaRegistry,
} from "../dist/index.js";
import {
  MessageFileStoreClosedError,
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
  SqliteWorkspaceStoreClosedError,
  SqliteWorkspaceStoreClosingError,
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

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-message-projection-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const conversationA = "conversation-main";
const conversationB = "conversation-custom";
const secretText = "SMOKE_SECRET_NOVEL_CONTENT";
const secretAssistantText = "SMOKE_SECRET_ASSISTANT_CONTENT";
const logEntries = [];
const logger = new CollectingLogger(logEntries);

try {
  await mkdir(workspaceRoot, { recursive: true });
  const locator = new NodeWorkspaceStoreLocator({ storageRoot });
  const location = await locator.resolve(workspaceRoot);
  const coreProjector = new CoreConversationRuntimeMessageProjector({ logger });

  const firstStore = await SqliteWorkspaceStore.open({
    workspace: location,
    logger,
  });
  await firstStore.conversations.createConversation({
    id: conversationA,
    workspaceId: location.workspaceId,
    agent: {
      agentType: "novel.main",
      definitionVersion: "1",
    },
  });
  await firstStore.conversations.createConversation({
    id: conversationB,
    workspaceId: location.workspaceId,
    agent: {
      agentType: "novel.custom",
      definitionVersion: "1",
    },
  });
  await firstStore.journal.append({
    direction: "input",
    snapshot: new UserMessageInputEvent({
      conversationId: conversationA,
      text: secretText,
      timestamp: "2026-08-01T00:00:00.000Z",
    }).getSnapshot(),
  });
  await firstStore.journal.append({
    direction: "output",
    snapshot: new AgentAssistantMessageCompletedOutputEvent({
      id: "assistant-output-main",
      conversationId: conversationA,
      runId: "run-main",
      turnId: "turn-main",
      assistantMessageId: "assistant-message-main",
      timestamp: "2026-08-01T00:00:00.500Z",
      content: [
        { type: "thinking", thinking: "projection-private-thinking" },
        { type: "text", text: secretAssistantText },
      ],
      completionReason: "stop",
      hasToolCalls: false,
    }).getSnapshot(),
  });
  await firstStore.journal.append({
    direction: "input",
    snapshot: new UserMessageInputEvent({
      conversationId: conversationB,
      text: "custom projection source",
      timestamp: "2026-08-01T00:00:01.000Z",
    }).getSnapshot(),
  });

  const contextA = firstStore.createMessageProjectionContext({
    projector: coreProjector,
  });
  const contextB = firstStore.createMessageProjectionContext({
    projector: coreProjector,
  });
  const firstSynchronization = await contextA.projections.synchronize(conversationA);
  await contextB.projections.synchronize(conversationB);
  assert.deepEqual(firstSynchronization.operations, ["initialized", "caught_up"]);

  const firstPage = await contextA.messages.list({ conversationId: conversationA });
  assert.equal(firstPage.items.length, 2);
  assert.equal(firstPage.items[0].message.payload.content[0].text, secretText);
  assert.deepEqual(firstPage.items[1].message, {
    id: firstPage.items[1].message.id,
    conversationId: conversationA,
    role: "assistant",
    messageType: "assistant.message",
    schemaVersion: 1,
    timestamp: "2026-08-01T00:00:00.500Z",
    runId: "run-main",
    turnId: "turn-main",
    payload: { content: [{ type: "text", text: secretAssistantText }] },
  });
  const deterministicMessageId = firstPage.items[0].message.id;
  const deterministicAssistantMessageId = firstPage.items[1].message.id;

  await contextA.close();
  await contextA.close();

  const firstClose = firstStore.close();
  assert.throws(
    () => firstStore.createMessageProjectionContext({ projector: coreProjector }),
    SqliteWorkspaceStoreClosingError,
  );
  await firstClose;
  await firstStore.close();
  assert.throws(
    () => firstStore.createMessageProjectionContext({ projector: coreProjector }),
    SqliteWorkspaceStoreClosedError,
  );
  await assert.rejects(
    () => contextB.messages.list({ conversationId: conversationB }),
    MessageFileStoreClosedError,
  );

  const reopenedStore = await SqliteWorkspaceStore.open({
    workspace: location,
    logger,
  });
  const reopenedContext = reopenedStore.createMessageProjectionContext({
    projector: coreProjector,
  });
  const ready = await reopenedContext.projections.inspect(conversationA);
  assert.equal(ready.health, "ready");
  const reopenedPage = await reopenedContext.messages.list({ conversationId: conversationA });
  assert.equal(reopenedPage.items[0].message.id, deterministicMessageId);
  assert.equal(reopenedPage.items[1].message.id, deterministicAssistantMessageId);

  const versionTwoProjector = {
    id: coreProjector.id,
    version: "4",
    project: (event) => coreProjector.project(event),
  };
  const versionTwoContext = reopenedStore.createMessageProjectionContext({
    projector: versionTwoProjector,
  });
  const migration = await versionTwoContext.projections.synchronize(conversationA);
  assert.deepEqual(migration.operations, ["rebuilt"]);
  assert.equal(migration.rebuildReason, "projector_changed");
  const migratedPage = await versionTwoContext.messages.list({ conversationId: conversationA });
  assert.notEqual(migratedPage.items[0].message.id, deterministicMessageId);
  assert.notEqual(migratedPage.items[1].message.id, deterministicAssistantMessageId);

  const customRegistry = createCoreRuntimeMessageSchemaRegistry();
  customRegistry.register({
    messageType: "smoke.custom",
    schemaVersion: 1,
    role: "custom",
    payloadSchema: Type.Object(
      {
        marker: Type.Literal("custom-registry"),
      },
      { additionalProperties: false },
    ),
  });
  const customProjector = {
    id: "smoke.custom",
    version: "1",
    project(event) {
      if (event.direction !== "input" || event.eventType !== INPUT_EVENT_TYPE.userMessage) {
        return [];
      }
      return [
        {
          role: "custom",
          messageType: "smoke.custom",
          schemaVersion: 1,
          timestamp: event.timestamp,
          payload: { marker: "custom-registry" },
        },
      ];
    },
  };
  const customContext = reopenedStore.createMessageProjectionContext({
    projector: customProjector,
    messageSchemaRegistry: customRegistry,
  });
  await customContext.projections.synchronize(conversationB);
  const customPage = await customContext.messages.list({ conversationId: conversationB });
  assert.equal(customPage.items[0].message.messageType, "smoke.custom");
  assert.deepEqual(customPage.items[0].message.payload, {
    marker: "custom-registry",
  });

  await reopenedStore.close();
  const serializedLogs = JSON.stringify(logEntries);
  assert.equal(serializedLogs.includes(secretText), false);
  assert.equal(serializedLogs.includes(secretAssistantText), false);
  assert.equal(serializedLogs.includes("projection-private-thinking"), false);
  assert.equal(serializedLogs.includes("custom projection source"), false);
  assert.equal(serializedLogs.includes('"payload"'), false);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Task 1C-E Message projection integration smoke passed");
