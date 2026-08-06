import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DefaultNovelApiClient,
  UserMessageInputEvent,
  novelAgentDefinition,
} from "../dist/index.js";
import {
  DEFAULT_NOVEL_AGENT_MANIFEST_ID,
  DefaultNovelConversationManifestProvisioner,
  NodeConversationApiApplication,
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
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
    this.exit.resolve({ kind: "stopped", exitedAt: "2026-08-04T04:00:03.000Z" });
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

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-default-agent-binding-"));
let seedStore;
let application;
try {
  const workspaceRoot = join(temporaryRoot, "workspace");
  const storageRoot = join(temporaryRoot, "storage");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  const provisioner = new DefaultNovelConversationManifestProvisioner();

  seedStore = await SqliteWorkspaceStore.open({ workspace });
  const seeded = await provisioner.provision(seedStore.agentManifests);
  await seedStore.close();
  seedStore = undefined;

  const placement = new TestRuntimePlacement();
  application = await NodeConversationApiApplication.open({
    workspace,
    placement,
    agentManifestProvisioner: provisioner,
  });
  const client = new DefaultNovelApiClient({ transport: application.transport });

  const bound = await client.conversations.create({
    conversationId: "conversation-default-bound",
    agent: {
      agentType: "novel",
      definitionVersion: novelAgentDefinition.definitionVersion,
    },
  });
  const boundSnapshot = await bound.getSnapshot();
  assert.equal(
    boundSnapshot.activeAgentBinding.manifestId,
    DEFAULT_NOVEL_AGENT_MANIFEST_ID,
  );
  assert.equal(
    boundSnapshot.activeAgentBinding.manifestDigest,
    seeded.manifestDigest,
  );

  const boundHandle = await client.conversations.open("conversation-default-bound");
  await boundHandle.input.enqueue(
    new UserMessageInputEvent({
      id: "input-default-bound",
      timestamp: "2026-08-04T04:00:00.000Z",
      text: "default bound input",
    }),
  );
  await waitUntil(
    () => placement.bootstraps.length === 1,
    "default bound runtime bootstrap",
  );
  const bootstrap = placement.bootstraps[0];
  assert.equal(
    bootstrap.conversation.activeAgentBinding.manifestId,
    DEFAULT_NOVEL_AGENT_MANIFEST_ID,
  );
  assert.equal(
    bootstrap.conversation.activeAgentBinding.manifestDigest,
    seeded.manifestDigest,
  );

  const explicit = await client.conversations.create({
    conversationId: "conversation-explicit-binding",
    agent: {
      agentType: "novel",
      definitionVersion: "1.0.0",
      manifestId: "manifest:explicit",
      manifestDigest: `sha256:${"e".repeat(64)}`,
    },
  });
  assert.equal(
    (await explicit.getSnapshot()).activeAgentBinding.manifestId,
    "manifest:explicit",
  );

  const other = await client.conversations.create({
    conversationId: "conversation-other-agent",
    agent: { agentType: "other_agent", definitionVersion: "1.0.0" },
  });
  assert.equal((await other.getSnapshot()).activeAgentBinding.manifestId, undefined);
  assert.equal(
    (await other.getSnapshot()).activeAgentBinding.manifestDigest,
    undefined,
  );

  const missing = await client.conversations.create({
    conversationId: "conversation-missing-manifest",
    agent: {
      agentType: "novel",
      definitionVersion: "1.0.0",
      manifestId: "manifest:missing",
      manifestDigest: `sha256:${"m".repeat(64)}`,
    },
  });
  assert.equal(
    (await missing.getSnapshot()).activeAgentBinding.manifestId,
    "manifest:missing",
  );
  const missingHandle = await client.conversations.open(
    "conversation-missing-manifest",
  );
  await missingHandle.input.enqueue(
    new UserMessageInputEvent({
      id: "input-missing-manifest",
      timestamp: "2026-08-04T04:00:01.000Z",
      text: "missing manifest input",
    }),
  );
  await waitUntil(
    async () => (await missingHandle.getRuntimePresence()).state === "crashed",
    "missing manifest activation failure",
  );

  const mismatch = await client.conversations.create({
    conversationId: "conversation-mismatch",
    agent: {
      agentType: "novel",
      definitionVersion: "1.0.0",
      manifestId: DEFAULT_NOVEL_AGENT_MANIFEST_ID,
      manifestDigest: `sha256:${"9".repeat(64)}`,
    },
  });
  assert.equal(
    (await mismatch.getSnapshot()).activeAgentBinding.manifestId,
    DEFAULT_NOVEL_AGENT_MANIFEST_ID,
  );
  const mismatchHandle = await client.conversations.open("conversation-mismatch");
  await mismatchHandle.input.enqueue(
    new UserMessageInputEvent({
      id: "input-mismatch",
      timestamp: "2026-08-04T04:00:02.000Z",
      text: "mismatch input",
    }),
  );
  await waitUntil(
    async () => (await mismatchHandle.getRuntimePresence()).state === "crashed",
    "manifest mismatch activation failure",
  );
  assert.equal(placement.bootstraps.length, 1);

  await boundHandle.close();
  await missingHandle.close();
  await mismatchHandle.close();
} finally {
  await application?.close();
  await seedStore?.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Default Novel Agent binding smoke passed");
