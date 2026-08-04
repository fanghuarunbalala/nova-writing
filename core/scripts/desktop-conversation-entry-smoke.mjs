import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UserMessageInputEvent } from "../dist/index.js";
import {
  DEFAULT_NOVEL_AGENT_MANIFEST_ID,
  NodeWorkspaceStoreLocator,
  openDesktopConversationEntry,
} from "../dist/node/index.js";

class TestRuntimeHandle {
  constructor(conversationId, runtimeInstanceId) {
    this.conversationId = conversationId;
    this.runtimeInstanceId = runtimeInstanceId;
    this.inputs = [];
    this.exit = deferred();
  }

  async dispatchInput(input) {
    this.inputs.push(input);
  }

  async shutdown() {
    this.exit.resolve({ kind: "stopped", exitedAt: "2026-08-04T06:00:02.000Z" });
  }

  waitForExit() {
    return this.exit.promise;
  }
}

class TestRuntimePlacement {
  constructor() {
    this.bootstraps = [];
    this.handles = [];
  }

  async activate(bootstrap) {
    this.bootstraps.push(bootstrap);
    const handle = new TestRuntimeHandle(
      bootstrap.conversation.metadata.id,
      bootstrap.runtimeInstanceId,
    );
    this.handles.push(handle);
    return handle;
  }
}

async function waitUntil(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-conversation-entry-"));
let entry;
let unavailableEntry;
try {
  const workspaceRoot = join(temporaryRoot, "workspace");
  const storageRoot = join(temporaryRoot, "storage");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );

  const placement = new TestRuntimePlacement();
  entry = await openDesktopConversationEntry({ workspace, placement });
  const conversation = await entry.client.conversations.create({
    conversationId: "conversation-entry",
    agent: { agentType: "novel_agent", definitionVersion: "1.0.0" },
  });
  const snapshot = await conversation.getSnapshot();
  assert.equal(
    snapshot.activeAgentBinding.manifestId,
    DEFAULT_NOVEL_AGENT_MANIFEST_ID,
  );

  await conversation.input.enqueue(
    new UserMessageInputEvent({
      id: "input-conversation-entry",
      timestamp: "2026-08-04T06:00:00.000Z",
      text: "conversation entry input",
    }),
  );
  await waitUntil(
    () => placement.bootstraps.length === 1,
    "conversation entry runtime bootstrap",
  );
  assert.equal(
    placement.bootstraps[0].conversation.activeAgentBinding.manifestId,
    DEFAULT_NOVEL_AGENT_MANIFEST_ID,
  );
  await conversation.close();
  await entry.close();
  entry = undefined;

  unavailableEntry = await openDesktopConversationEntry({ workspace });
  const unavailable = await unavailableEntry.client.conversations.create({
    conversationId: "conversation-entry-unavailable",
    agent: { agentType: "novel_agent", definitionVersion: "1.0.0" },
  });
  const unavailableHandle = await unavailableEntry.client.conversations.open(
    "conversation-entry-unavailable",
  );
  await unavailableHandle.input.enqueue(
    new UserMessageInputEvent({
      id: "input-conversation-entry-unavailable",
      timestamp: "2026-08-04T06:00:01.000Z",
      text: "unavailable entry input",
    }),
  );
  await waitUntil(
    async () => (await unavailableHandle.getRuntimePresence()).state === "crashed",
    "unavailable conversation entry activation failure",
  );
  await unavailableHandle.close();
  await unavailableEntry.close();
  unavailableEntry = undefined;
} finally {
  await entry?.close();
  await unavailableEntry?.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Desktop Conversation entry smoke passed");
