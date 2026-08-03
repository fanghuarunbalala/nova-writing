import assert from "node:assert/strict";
import {
  ConversationCatalogController,
  DEFAULT_NOVEL_AGENT_BINDING,
} from "../dist/index.js";

const snapshots = [];
const createOptions = [];
let createCount = 0;
const api = {
  conversations: {
    async list() {
      return { conversations: [...snapshots] };
    },
    async create(options) {
      createOptions.push(options);
      createCount += 1;
      const snapshot = createSnapshot(`conversation-${createCount}`, createCount);
      snapshots.push(snapshot);
      return createHandle(snapshot);
    },
    async open() {
      throw new Error("not used");
    },
  },
};

const controller = new ConversationCatalogController({ api });
const observed = [];
const unsubscribe = controller.subscribe(() => observed.push(controller.getSnapshot()));
const initial = await controller.openWorkspace("workspace-1");
assert.ok(initial);
assert.equal(initial.id, "conversation-1");
assert.equal(controller.getSnapshot().phase, "ready");
assert.equal(controller.getSnapshot().conversations.length, 1);
assert.equal(controller.getSnapshot().activeConversationId, "conversation-1");
assert.deepEqual(createOptions[0].agent, DEFAULT_NOVEL_AGENT_BINDING);

const created = await controller.createConversation();
assert.ok(created);
assert.equal(created.id, "conversation-2");
assert.equal(controller.getSnapshot().conversations.length, 2);
assert.equal(controller.getSnapshot().activeConversationId, "conversation-2");
assert.equal(
  controller.selectConversation("conversation-1").id,
  "conversation-1",
);
assert.equal(controller.getSnapshot().activeConversationId, "conversation-1");
assert.equal(controller.selectConversation("missing"), undefined);

controller.clearWorkspace();
assert.equal(controller.getSnapshot().phase, "idle");
assert.equal(controller.getSnapshot().workspaceId, undefined);
assert.deepEqual(controller.getSnapshot().conversations, []);
assert.ok(observed.length >= 5);
assert.ok(Object.isFrozen(controller.getSnapshot()));
assert.ok(Object.isFrozen(initial));
unsubscribe();

console.log("conversation catalog controller smoke passed");

function createSnapshot(conversationId, index) {
  const timestamp = `2026-08-03T00:00:0${index}.000Z`;
  return Object.freeze({
    metadata: Object.freeze({
      id: conversationId,
      workspaceId: "workspace-1",
      rootConversationId: conversationId,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastJournalSequence: 0,
    }),
    activeAgentBinding: Object.freeze({
      id: `binding-${conversationId}`,
      conversationId,
      revision: 1,
      agentType: "novel_agent",
      definitionVersion: "1.0.0",
      status: "active",
      createdAt: timestamp,
    }),
  });
}

function createHandle(snapshot) {
  return Object.freeze({
    id: snapshot.metadata.id,
    input: {},
    events: {},
    getSnapshot: async () => snapshot,
    getRuntimePresence: async () => ({
      state: "offline",
      observedAt: snapshot.metadata.updatedAt,
    }),
    close: async () => undefined,
  });
}
