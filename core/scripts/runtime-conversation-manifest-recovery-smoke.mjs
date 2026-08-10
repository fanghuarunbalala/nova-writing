import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AgentAssembler,
  AgentManifestResolver,
  DefaultNovelApiClient,
  InMemoryAgentManifestStore,
  PromptCapabilitySnapshot,
  ManifestSystemPromptCompiler,
  UserMessageInputEvent,
  createDefaultPromptSectionRegistry,
  novelAgentDefinition,
} from "../dist/index.js";
import {
  NodeConversationApiApplication,
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
  createNovelConversationManifestComposition,
} from "../dist/node/index.js";

class Sha256Digester {
  algorithm = "sha256";

  async digest(content) {
    return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
  }
}

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
    this.exit.resolve({ kind: "stopped", exitedAt: "2026-08-03T03:00:00.000Z" });
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

class RuntimeInstanceIdGenerator {
  constructor() {
    this.sequence = 0;
  }

  generate() {
    this.sequence += 1;
    return `rt_manifest_recovery_${this.sequence}`;
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-runtime-manifest-recovery-"));
let seedStore;
let firstApplication;
let secondApplication;

try {
  const workspaceRoot = join(temporaryRoot, "workspace");
  const storageRoot = join(temporaryRoot, "storage");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  const manifest = await createManifest();

  seedStore = await SqliteWorkspaceStore.open({ workspace });
  await seedStore.agentManifests.save(manifest);
  await seedStore.close();
  seedStore = undefined;

  firstApplication = await NodeConversationApiApplication.open({
    workspace,
    placement: new TestRuntimePlacement(),
  });
  const firstClient = new DefaultNovelApiClient({
    transport: firstApplication.transport,
  });
  await firstClient.conversations.create({
    conversationId: "conversation-manifest-recovery",
    agent: {
      agentType: manifest.definition.agentType,
      definitionVersion: manifest.definition.definitionVersion,
      manifestId: manifest.manifestId,
      manifestDigest: manifest.manifestDigest,
    },
  });
  await firstClient.conversations.create({
    conversationId: "conversation-digest-only",
    agent: {
      agentType: "conversation.digest_only",
      definitionVersion: "1.0.0",
      manifestDigest: manifest.manifestDigest,
    },
  });
  await firstClient.conversations.create({
    conversationId: "conversation-legacy-binding",
    agent: {
      agentType: "conversation.legacy",
      definitionVersion: "1.0.0",
    },
  });
  await firstApplication.close();
  firstApplication = undefined;

  const placement = new TestRuntimePlacement();
  secondApplication = await NodeConversationApiApplication.open({
    workspace,
    placement,
    runtimeInstanceIdGenerator: new RuntimeInstanceIdGenerator(),
  });
  const secondClient = new DefaultNovelApiClient({
    transport: secondApplication.transport,
  });

  const replayConversation = await secondClient.conversations.open(
    "conversation-manifest-recovery",
  );
  const replay = await replayConversation.events.list({
    anchor: { from: "start" },
    limit: 10,
  });
  assert.equal(replay.events.length, 0);
  assert.equal(placement.handles.length, 0);
  assert.equal((await replayConversation.getRuntimePresence()).state, "offline");

  const manifestReceipt = await replayConversation.input.enqueue(
    new UserMessageInputEvent({
      id: "input-manifest-recovery",
      timestamp: "2026-08-03T03:00:01.000Z",
      text: "manifest recovery input",
    }),
  );
  assert.equal(manifestReceipt.status, "accepted");
  await waitUntil(
    () => placement.bootstraps.length === 1,
    "manifest Conversation runtime bootstrap",
  );
  assert.deepEqual(
    {
      manifestId: placement.bootstraps[0].conversation.activeAgentBinding.manifestId,
      manifestDigest:
        placement.bootstraps[0].conversation.activeAgentBinding.manifestDigest,
    },
    { manifestId: manifest.manifestId, manifestDigest: manifest.manifestDigest },
  );
  assert.ok(placement.bootstraps[0].journal.highWatermark >= manifestReceipt.sequence);

  const digestOnlyConversation = await secondClient.conversations.open(
    "conversation-digest-only",
  );
  await digestOnlyConversation.input.enqueue(
    new UserMessageInputEvent({
      id: "input-digest-only",
      timestamp: "2026-08-03T03:00:02.000Z",
      text: "digest only input",
    }),
  );
  const legacyConversation = await secondClient.conversations.open(
    "conversation-legacy-binding",
  );
  await legacyConversation.input.enqueue(
    new UserMessageInputEvent({
      id: "input-legacy-binding",
      timestamp: "2026-08-03T03:00:03.000Z",
      text: "legacy binding input",
    }),
  );
  await waitUntil(
    () => placement.bootstraps.length === 3,
    "legacy binding compatibility bootstraps",
  );
  assert.equal(placement.bootstraps[1].conversation.activeAgentBinding.manifestId, undefined);
  assert.equal(
    placement.bootstraps[1].conversation.activeAgentBinding.manifestDigest,
    manifest.manifestDigest,
  );
  assert.equal(placement.bootstraps[2].conversation.activeAgentBinding.manifestId, undefined);
  assert.equal(placement.bootstraps[2].conversation.activeAgentBinding.manifestDigest, undefined);

  await replayConversation.close();
  await digestOnlyConversation.close();
  await legacyConversation.close();
} finally {
  await secondApplication?.close();
  await firstApplication?.close();
  await seedStore?.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("runtime Conversation manifest recovery smoke passed");

async function createManifest() {
  const digester = new Sha256Digester();
  const resolver = new AgentManifestResolver({
    promptBuilder: new ManifestSystemPromptCompiler({
      sections: createDefaultPromptSectionRegistry(),
      digester,
    }),
    promptCapabilities: new PromptCapabilitySnapshot([]),
    manifestIdFactory: { create() { return "manifest:conversation-recovery"; } },
    clock: { now() { return "2026-08-03T03:00:00.000Z"; } },
    digester,
  });
  const composition = createNovelConversationManifestComposition();
  return new AgentAssembler({
    registry: composition.registry,
    groups: composition.groups,
    manifestResolver: resolver,
    manifestStore: new InMemoryAgentManifestStore(),
  }).assemble(novelAgentDefinition).then((assembly) => assembly.manifest);
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function waitUntil(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${label}`);
}
