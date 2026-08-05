import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDefaultApplicationConfiguration,
} from "../dist/index.js";
import {
  captureProviderRequestDebugSnapshot,
  PiProviderExecutionFactory,
} from "../dist/runtime/agent/pi/index.js";
import { createNodeProviderRequestDebugRecorder } from "../dist/node/index.js";

const root = await mkdtemp(join(tmpdir(), "provider-request-debug-"));
const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
};

try {
  const dumpPath = join(root, "provider-requests.jsonl");
  const recorder = createNodeProviderRequestDebugRecorder({
    path: dumpPath,
    logger,
  });
  const dispatched = [];
  const dispatcher = {
    stream(api, model) {
      dispatched.push({ api, modelId: model.id });
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "done",
            reason: "stop",
            message: { role: "assistant", content: [], stopReason: "stop" },
          };
        },
      };
    },
  };
  const credentials = {
    async use(_reference, operation) {
      return operation("SECRET_API_KEY");
    },
    async getStatus() {
      return "configured";
    },
  };
  const factory = new PiProviderExecutionFactory({
    dispatcher,
    credentials,
    debugRecorder: recorder,
    logger,
  });
  const descriptor = {
    schemaVersion: 1,
    source: "default",
    modelProfileId: "profile_debug",
    modelConnectionId: "connection_debug",
    providerKind: "openai",
    api: "openai-completions",
    modelId: "model_debug",
    baseUrl: "https://provider.example",
    parameters: { temperature: 0.5, maximumOutputTokens: 128 },
    capabilityOverrides: {},
    fallbackProfileIds: [],
    publicHeaders: {},
    credentialReference: "ref:credential",
    secretHeaderCredentialReferences: {},
  };
  const streamFn = factory.create(descriptor);
  const model = {
    id: "model_debug",
    name: "Debug Model",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://provider.example",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 1024,
    headers: { Authorization: "Bearer SECRET_API_KEY" },
  };
  const context = {
    systemPrompt: "DEBUG_SYSTEM_PROMPT",
    messages: [
      { role: "user", content: [{ type: "text", text: "DEBUG_MESSAGE" }] },
    ],
    tools: [
      {
        name: "TestTool",
        description: "DEBUG_TOOL_DESC",
        parameters: { type: "object" },
      },
    ],
  };
  const options = {
    temperature: 0.5,
    maxTokens: 128,
    apiKey: "SECRET_API_KEY",
    headers: { Authorization: "Bearer SECRET_API_KEY" },
  };
  const hooks = {
    async onDispatched() {},
    async onFailedBeforeDispatch() {},
  };
  await streamFn(model, context, options, hooks);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].modelId, "model_debug");

  const lines = (await readFile(dumpPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.equal(lines.length, 1);
  const snapshot = JSON.parse(lines[0]);
  assert.equal(snapshot.api, "openai-completions");
  assert.equal(snapshot.model.id, "model_debug");
  assert.equal(snapshot.model.provider, "openai");
  assert.equal(snapshot.config.modelProfileId, "profile_debug");
  assert.equal(snapshot.config.modelId, "model_debug");
  assert.equal(snapshot.config.parameters.temperature, 0.5);
  assert.equal(snapshot.prompt, "DEBUG_SYSTEM_PROMPT");
  assert.equal(snapshot.messages[0].role, "user");
  assert.equal(snapshot.tools[0].name, "TestTool");
  assert.equal(snapshot.options.maxTokens, 128);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("SECRET_API_KEY"), false);
  assert.equal(serialized.includes("credentialReference"), false);
  assert.equal(serialized.includes("apiKey"), false);
  assert.equal(serialized.includes("Authorization"), false);

  const bigPrompt = "x".repeat(400_000);
  const unit = captureProviderRequestDebugSnapshot({
    recordedAt: "2026-08-05T00:00:00.000Z",
    descriptor,
    model,
    context: { systemPrompt: bigPrompt, messages: [], tools: [] },
    options: {},
  });
  assert.equal(unit.prompt.includes("truncated"), true);

  const defaults = createDefaultApplicationConfiguration();
  assert.equal(defaults.diagnostics.providerRequestDumpEnabled, false);
  assert.equal(defaults.diagnostics.providerRequestDumpPath, undefined);

  console.log("CORE_SMOKE_TEST_RESULT=pass provider-request-debug-recorder");
} finally {
  await rm(root, { recursive: true, force: true });
}
