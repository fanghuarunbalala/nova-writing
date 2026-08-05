import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AgentCommunicationPolicy,
  AgentDefinition,
  AgentDelegationPolicy,
  AgentManifest,
  AgentManifestDelegation,
  AgentManifestPrompt,
  AgentManifestStoreError,
  AgentManifestTool,
  AgentToolPolicy,
  InlinePromptItem,
  PromptRecipe,
  PromptSectionItem,
  ResolvedPromptRecipe,
} from "../dist/index.js";
import {
  DEFAULT_NOVEL_AGENT_MANIFEST_ID,
  DefaultNovelConversationManifestError,
  DefaultNovelConversationManifestProvisioner,
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
} from "../dist/node/index.js";

const records = [];
const logger = createCapturingLogger(records);
const provisioner = new DefaultNovelConversationManifestProvisioner({ logger });

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-default-agent-manifest-"));
let workspaceStore;
try {
  const workspaceRoot = join(temporaryRoot, "workspace");
  const storageRoot = join(temporaryRoot, "storage");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );

  workspaceStore = await SqliteWorkspaceStore.open({ workspace });
  const first = await provisioner.provision(workspaceStore.agentManifests);
  assert.equal(first.manifestId, DEFAULT_NOVEL_AGENT_MANIFEST_ID);
  assert.equal(first.agentType, "novel");
  assert.equal(first.definitionVersion, "1.0.0");
  assert.match(first.manifestDigest, /^sha256:[0-9a-f]{64}$/);

  const second = await provisioner.provision(workspaceStore.agentManifests);
  assert.equal(second.manifestId, first.manifestId);
  assert.equal(second.manifestDigest, first.manifestDigest);
  assert.equal(
    (await workspaceStore.agentManifests.getByAgent("novel", "1.0.0"))
      .length,
    1,
  );

  await workspaceStore.close();
  workspaceStore = await SqliteWorkspaceStore.open({ workspace });
  const restored = await provisioner.provision(workspaceStore.agentManifests);
  assert.equal(restored.manifestId, first.manifestId);
  assert.equal(restored.manifestDigest, first.manifestDigest);
  await workspaceStore.close();
  workspaceStore = undefined;

  const conflictStore = {
    async get() {
      return undefined;
    },
    async save() {
      throw new AgentManifestStoreError("manifest_conflict");
    },
    async getByAgent() {
      return [];
    },
  };
  await assert.rejects(
    provisioner.provision(conflictStore),
    (error) =>
      error instanceof DefaultNovelConversationManifestError &&
      error.failure === "conflict" &&
      error.code === "DEFAULT_NOVEL_MANIFEST_CONFLICT",
  );

  const mismatched = createMismatchedManifest(first);
  const mismatchStore = {
    async get() {
      return mismatched;
    },
    async save() {
      throw new Error("unexpected save during mismatch");
    },
    async getByAgent() {
      return [mismatched];
    },
  };
  await assert.rejects(
    provisioner.provision(mismatchStore),
    (error) =>
      error instanceof DefaultNovelConversationManifestError &&
      error.failure === "mismatch" &&
      error.code === "DEFAULT_NOVEL_MANIFEST_MISMATCH",
  );

  const serializedLogs = JSON.stringify(records);
  assert.equal(serializedLogs.includes(first.compiledPrompt.content), false);
  assert.equal(serializedLogs.includes(workspaceRoot), false);
  assert.equal(serializedLogs.includes(storageRoot), false);
} finally {
  await workspaceStore?.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Default Novel Conversation Manifest provisioning smoke passed");

function createMismatchedManifest(reference) {
  const otherDefinition = new AgentDefinition({
    agentType: "other_agent",
    definitionVersion: "1.0.0",
    label: "Other Agent",
    description: "mismatch seed",
    promptRecipe: new PromptRecipe([
      new PromptSectionItem("core.runtime.protocol"),
      new InlinePromptItem("Respond in the language currently used by the user."),
    ]),
    tools: new AgentToolPolicy({ groupIds: ["runtime.todo"] }),
    delegation: new AgentDelegationPolicy({
      mode: "disabled",
      allowedAgentTypes: [],
    }),
    communication: new AgentCommunicationPolicy("standalone"),
    runtimePolicyId: "default",
  });
  return new AgentManifest({
    manifestId: DEFAULT_NOVEL_AGENT_MANIFEST_ID,
    manifestDigest: `sha256:${"a".repeat(64)}`,
    definition: otherDefinition,
    promptRecipe: new ResolvedPromptRecipe([...reference.promptRecipe.items]),
    compiledPrompt: new AgentManifestPrompt({
      content: "other compiled prompt",
      digest: reference.compiledPrompt.digest,
    }),
    tools: [new AgentManifestTool({ name: "TodoWrite", version: "1.0.0" })],
    delegation: new AgentManifestDelegation({
      mode: "disabled",
      allowedAgentTypes: [],
    }),
    communicationRole: "standalone",
    runtimePolicyId: "default",
    createdAt: reference.createdAt,
  });
}

function createCapturingLogger(records) {
  function capture(level) {
    return (event, fields = {}) => {
      records.push({ level, event, fields });
    };
  }
  return {
    debug: capture("debug"),
    info: capture("info"),
    warn: capture("warn"),
    error: capture("error"),
    child() {
      return createCapturingLogger(records);
    },
  };
}
