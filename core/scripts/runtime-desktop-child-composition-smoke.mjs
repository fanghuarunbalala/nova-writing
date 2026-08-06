import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BaseContextCompiler,
  INPUT_EVENT_TYPE,
} from "../dist/index.js";
import {
  DefaultNovelConversationManifestProvisioner,
  DesktopRuntimeChildCompositionFactory,
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
} from "../dist/node/index.js";

const conversationId = "conversation-desktop-child";
const runtimeInstanceId = "runtime-desktop-child";
const forbidden = [
  "FORBIDDEN_CHILD_PROMPT",
  "FORBIDDEN_CHILD_SYSTEM_PROMPT",
  "/private/workdir",
  "FORBIDDEN_CHILD_MANIFEST",
];
const records = [];
const logger = createLogger(records);
const adapterRequests = [];
const journalEvents = [];

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-desktop-child-"));
let manifestStore;
try {
  const workspaceRoot = join(temporaryRoot, "workspace");
  const storageRoot = join(temporaryRoot, "storage");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  const provisioner = new DefaultNovelConversationManifestProvisioner({ logger });
  const seedStore = await SqliteWorkspaceStore.open({ workspace });
  const seeded = await provisioner.provision(seedStore.agentManifests);
  await seedStore.close();
  manifestStore = await SqliteWorkspaceStore.open({ workspace });

  const bootstrap = Object.freeze({
    schemaVersion: 1,
    runtimeInstanceId,
    activatedAt: "2026-08-04T05:00:00.000Z",
    conversation: Object.freeze({
      metadata: Object.freeze({
        id: conversationId,
        workspaceId: workspace.workspaceId,
        rootConversationId: conversationId,
        status: "active",
        createdAt: "2026-08-04T05:00:00.000Z",
        updatedAt: "2026-08-04T05:00:00.000Z",
        lastJournalSequence: 0,
      }),
      activeAgentBinding: Object.freeze({
        id: "binding-desktop-child",
        conversationId,
        revision: 1,
        agentType: seeded.agentType,
        definitionVersion: seeded.definitionVersion,
        manifestId: seeded.manifestId,
        manifestDigest: seeded.manifestDigest,
        status: "active",
        createdAt: "2026-08-04T05:00:00.000Z",
      }),
    }),
    workspace: Object.freeze({
      workspaceId: workspace.workspaceId,
      workdir: "/private/workdir",
    }),
    activation: Object.freeze({ reason: "explicit_restore" }),
    journal: Object.freeze({ highWatermark: 0 }),
  });

  const factory = new DesktopRuntimeChildCompositionFactory({
    manifestStoreProvider: async () => manifestStore.agentManifests,
    adapterFactory: {
      async create({ lifecycleController }) {
        return {
          stream: async (request) => {
            adapterRequests.push(request);
            await lifecycleController.beginTurn();
            await lifecycleController.transitionTurn({
              current: "completed",
              reason: "turn_completed",
            });
            return Object.freeze({
              conversationId,
              runId: request.runId,
              outcome: "completed",
            });
          },
          cancel: async () => undefined,
        };
      },
    },
    contextCompilerFactory: {
      async create() {
        return new BaseContextCompiler({ logger });
      },
    },
    preparationSourceFactory: {
      async create() {
        return {
          prepare: async (request) =>
            Object.freeze({
              conversationId,
              runId: request.runId,
              basePrompt: Object.freeze({
                content: "FORBIDDEN_CHILD_SYSTEM_PROMPT",
                digest:
                  "sha256:0000000000000000000000000000000000000000000000000000000000000000",
              }),
              messageHighWatermark: 0,
              contextMessages: Object.freeze([]),
              invocation: Object.freeze({
                kind: "prompt",
                messages: Object.freeze([
                  runtimeUserMessage(request.input),
                ]),
              }),
            }),
        };
      },
    },
    logger,
  });

  const child = await factory.create(bootstrap, {
    persistence: createPersistence(),
  });
  const startup = await child.start(bootstrap);
  assert.equal(startup.conversationId, conversationId);
  assert.equal(startup.runtimeInstanceId, runtimeInstanceId);

  journalEvents.push(
    Object.freeze({
      id: "input-desktop-child",
      conversationId,
      eventType: INPUT_EVENT_TYPE.userMessage,
      schemaVersion: 1,
      priority: 500,
      timestamp: "2026-08-04T05:00:01.000Z",
      correlationId: "correlation-desktop-child",
      payload: Object.freeze({
        text: "FORBIDDEN_CHILD_PROMPT",
      }),
      direction: "input",
      sequence: 1,
      recordedAt: "2026-08-04T05:00:01.000Z",
    }),
  );
  await child.dispatchInput({
    conversationId,
    inputEventId: "input-desktop-child",
    eventType: INPUT_EVENT_TYPE.userMessage,
    sequence: 1,
  });
  await waitUntil(
    () =>
      adapterRequests.length === 1 &&
      journalEvents.some(
        (event) =>
          event.direction === "output" &&
          event.eventType === "agent.run.state.changed",
      ),
    "desktop child run completion",
  );
  assert.equal(adapterRequests.length, 1);
  assert.equal(adapterRequests[0].conversationId, conversationId);
  assert.equal(
    adapterRequests[0].context.systemPrompt,
    "FORBIDDEN_CHILD_SYSTEM_PROMPT",
  );
  assert.equal(adapterRequests[0].invocation.messages.length, 1);

  await child.shutdown({ reason: "explicit_shutdown" });
  const exit = await child.waitForExit();
  assert.equal(exit.kind, "stopped");

  const serializedLogs = JSON.stringify(records);
  assert.ok(
    records.some((record) =>
      record.includes('"runtime_child.composition_created"'),
    ),
    "composition created log missing",
  );
  for (const token of forbidden) {
    assert.equal(serializedLogs.includes(token), false);
  }

  const failingFactory = new DesktopRuntimeChildCompositionFactory({
    manifestStoreProvider: async () => {
      throw new TypeError("FORBIDDEN_CHILD_MANIFEST");
    },
    adapterFactory: {
      async create() {
        throw new Error("unused");
      },
    },
    contextCompilerFactory: {
      async create() {
        throw new Error("unused");
      },
    },
    preparationSourceFactory: {
      async create() {
        throw new Error("unused");
      },
    },
    logger,
  });
  await assert.rejects(
    failingFactory.create(bootstrap, { persistence: createPersistence() }),
  );
  assert.ok(
    records.some((record) =>
      record.includes('"runtime_child.composition_failed"'),
    ),
    "composition failed log missing",
  );
  assert.equal(
    records.some((record) => record.includes("FORBIDDEN_CHILD_MANIFEST")),
    false,
  );
} finally {
  await manifestStore?.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Desktop Runtime child composition smoke passed");

function createPersistence() {
  return {
    journal: {
      async getEvent(cid, sequence) {
        return journalEvents.find(
          (event) => event.conversationId === cid && event.sequence === sequence,
        );
      },
      async listEvents(query) {
        const events = journalEvents.filter(
          (event) => event.conversationId === query.conversationId,
        );
        return {
          events,
          highWatermark: events.length,
          hasPrevious: false,
          hasNext: false,
        };
      },
      async appendOutput(cid, snapshot) {
        const sequence = journalEvents.length + 1;
        journalEvents.push(
          Object.freeze({
            ...snapshot,
            conversationId: cid,
            direction: "output",
            sequence,
            recordedAt: "2026-08-04T05:00:02.000Z",
          }),
        );
        return {
          status: "appended",
          conversationId: cid,
          sequence,
          recordedAt: "2026-08-04T05:00:02.000Z",
        };
      },
    },
    messages: {
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
    runtimeState: {
      async load() {
        return undefined;
      },
      async save() {
        return Object.freeze({ acknowledged: true });
      },
    },
  };
}

function runtimeUserMessage(input) {
  return Object.freeze({
    id: input.id,
    conversationId,
    role: "user",
    messageType: "user.message",
    schemaVersion: 1,
    timestamp: input.timestamp,
    payload: Object.freeze({
      content: Object.freeze([
        Object.freeze({ type: "text", text: input.payload.text }),
      ]),
    }),
  });
}

async function waitUntil(predicate, label) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${label}`);
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
