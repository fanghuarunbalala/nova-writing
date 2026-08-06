import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  INPUT_EVENT_TYPE,
} from "../dist/index.js";
import {
  createChildProcessConversationRuntimePlacement,
  RuntimeProcessExitNormalizer,
} from "../dist/node/index.js";

const conversationId = "conversation-desktop-endpoint";
const journalEvents = [
  Object.freeze({
    id: "journal-event-1",
    conversationId,
    eventType: INPUT_EVENT_TYPE.userMessage,
    schemaVersion: 1,
    priority: 500,
    timestamp: "2026-08-04T08:00:00.000Z",
    correlationId: "correlation-desktop-endpoint",
    payload: Object.freeze({ text: "persistence input" }),
    direction: "input",
    sequence: 1,
    recordedAt: "2026-08-04T08:00:00.000Z",
  }),
];
let persistenceCalls = 0;

const fixturePath = fileURLToPath(
  new URL("./fixtures/runtime-desktop-child-persistence.mjs", import.meta.url),
);
const records = [];
const placement = createChildProcessConversationRuntimePlacement({
  command: process.execPath,
  args: [fixturePath],
  logger: createLogger(records),
  exitNormalizer: new RuntimeProcessExitNormalizer({
    clock: { now: () => "2026-08-04T08:00:02.000Z" },
  }),
  persistenceProvider: {
    provide: async () => {
      persistenceCalls += 1;
      return {
        journalReader: {
          async getHighWatermark() {
            return 1;
          },
          async getBySequence(cid, sequence) {
            return journalEvents.find(
              (event) =>
                event.conversationId === cid && event.sequence === sequence,
            );
          },
          async getByEventId(cid, eventId) {
            return journalEvents.find(
              (event) => event.conversationId === cid && event.id === eventId,
            );
          },
          async list(query) {
            return {
              events: journalEvents.filter(
                (event) => event.conversationId === query.conversationId,
              ),
              highWatermark: journalEvents.length,
              hasPrevious: false,
              hasNext: false,
            };
          },
        },
        journalService: {
          async append() {
            throw new Error("append is outside this smoke scope");
          },
          async close() {},
        },
        messageStore: {
          async list() {
            return {
              conversationId,
              items: [],
              highWatermarkMessageIndex: 0,
              projectedThroughSequence: 0,
              hasMore: false,
            };
          },
        },
      };
    },
  },
});

const bootstrap = createBootstrap();
let handle;
try {
  handle = await placement.activate(bootstrap);
} catch (error) {
  console.error(error.stack);
  throw error;
}
assert.equal(handle.conversationId, conversationId);
await handle.dispatchInput({
  conversationId,
  inputEventId: "input-desktop-endpoint",
  eventType: INPUT_EVENT_TYPE.userMessage,
  sequence: 1,
});
await handle.shutdown({
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
});
assert.deepEqual(await withTimeout(handle.waitForExit()), {
  kind: "stopped",
  exitedAt: "2026-08-04T08:00:02.000Z",
  reason: "explicit_shutdown",
});
await placement.close();
assert.equal(persistenceCalls, 1);
assert.ok(
  records.some((record) =>
    record.includes('"desktop_runtime_child_endpoint.persistence_bound"'),
  ),
  "persistence bound log missing",
);

console.log("Desktop Runtime child endpoint smoke passed");

function createBootstrap() {
  return Object.freeze({
    schemaVersion: 1,
    runtimeInstanceId: "runtime-desktop-endpoint",
    activatedAt: "2026-08-04T08:00:00.000Z",
    conversation: Object.freeze({
      metadata: Object.freeze({
        id: conversationId,
        workspaceId: "workspace-desktop-endpoint",
        rootConversationId: conversationId,
        status: "active",
        createdAt: "2026-08-04T08:00:00.000Z",
        updatedAt: "2026-08-04T08:00:00.000Z",
        lastJournalSequence: 1,
      }),
      activeAgentBinding: Object.freeze({
        id: "binding-desktop-endpoint",
        conversationId,
        revision: 1,
        agentType: "novel_agent",
        definitionVersion: "1.0.0",
        status: "active",
        createdAt: "2026-08-04T08:00:00.000Z",
      }),
    }),
    workspace: Object.freeze({
      workspaceId: "workspace-desktop-endpoint",
      workdir: "/private/workdir",
    }),
    activation: Object.freeze({ reason: "explicit_restore" }),
    journal: Object.freeze({ highWatermark: 1 }),
  });
}

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      setTimeout(
        () => reject(new Error("Timed out waiting for child exit")),
        15_000,
      );
    }),
  ]);
}

function createLogger(records) {
  const logger = {
    debug: (event, fields = {}) => records.push(JSON.stringify({ event, fields })),
    info: (event, fields = {}) => records.push(JSON.stringify({ event, fields })),
    warn: (event, fields = {}) => records.push(JSON.stringify({ event, fields })),
    error: (event, fields = {}) => records.push(JSON.stringify({ event, fields })),
    child: () => logger,
  };
  return logger;
}
