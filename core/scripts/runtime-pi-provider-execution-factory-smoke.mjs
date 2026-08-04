import assert from "node:assert/strict";
import {
  PiAiProviderExecutionDispatcher,
  PiProviderExecutionFactory,
  createErrorAssistantMessage,
  createPiExecutionModel,
} from "../dist/runtime/agent/pi/index.js";

const forbidden = [
  "secret-",
  "model-test",
  "https://provider.example",
  "fetch failed",
  "HTTP 429",
];
const records = [];
const logger = createLogger(records);

const supportedApis = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];
for (const api of supportedApis) {
  const dispatcher = createTestDispatcher(() => completedStream(assistantMessage("stop")));
  const factory = createFactory(dispatcher, logger);
  const streamFunction = factory.create(descriptor(api));
  const hooks = createHooks();
  const stream = await streamFunction(
    sourceModel(api),
    { messages: [], systemPrompt: "system" },
    { signal: new AbortController().signal },
    hooks,
  );
  const events = await collectEvents(stream);
  assert.equal(events.at(-1).type, "done");
  assert.equal(dispatcher.calls.length, 1);
  assert.equal(dispatcher.calls[0].api, api);
  assert.equal(dispatcher.calls[0].model.id, "model-test");
  assert.equal(dispatcher.calls[0].model.api, api);
  assert.equal(dispatcher.calls[0].model.headers["x-public"], "public-value");
  assert.equal(dispatcher.calls[0].options.headers["x-public"], "public-value");
  assert.equal(dispatcher.calls[0].options.apiKey, "secret-credential:primary");
  assert.equal(hooks.calls.some((call) => call.kind === "dispatched"), true);
}
assert.ok(
  records.some((record) => record.includes('"pi_provider_execution.stream_created"')),
  "provider dispatch debug log missing",
);
assert.ok(
  records.some((record) => record.includes('"pi_provider_execution.completed"')),
  "provider completion debug log missing",
);

{
  const dispatcher = createTestDispatcher();
  const factory = createFactory(dispatcher, logger);
  const streamFunction = factory.create(descriptor("pi-messages"));
  const hooks = createHooks();
  const events = await collectEvents(
    await streamFunction(sourceModel("pi-messages"), { messages: [] }, {}, hooks),
  );
  assert.equal(events.at(-1).type, "error");
  assert.equal(events.at(-1).error.errorMessage, "unsupported_api");
  assert.equal(
    hooks.calls.some((call) => call.kind === "failedBeforeDispatch"),
    true,
  );
  assert.equal(dispatcher.calls.length, 0);
}

const statusCases = [
  [429, "rate_limit"],
  [401, "auth"],
  [403, "auth"],
  [500, "response"],
  ["The request timed out", "timeout"],
  ["HTTP 504 gateway timeout", "timeout"],
];
for (const [marker, expected] of statusCases) {
  const dispatcher = createTestDispatcher(() =>
    errorStream(
      assistantMessage(
        "error",
        typeof marker === "number"
          ? `HTTP ${marker} provider failure`
          : marker,
      ),
    ),
  );
  const factory = createFactory(dispatcher, logger);
  const events = await collectEvents(
    await factory.create(descriptor("openai-responses"))(
      sourceModel("openai-responses"),
      { messages: [] },
      {},
      createHooks(),
    ),
  );
  assert.equal(events.at(-1).type, "error");
  assert.equal(events.at(-1).error.errorMessage, expected);
}

{
  const dispatcher = createTestDispatcher(() =>
    errorStream(assistantMessage("aborted", "provider aborted")),
  );
  const factory = createFactory(dispatcher, logger);
  const events = await collectEvents(
    await factory.create(descriptor("anthropic-messages"))(
      sourceModel("anthropic-messages"),
      { messages: [] },
      {},
      createHooks(),
    ),
  );
  assert.equal(events.at(-1).error.errorMessage, "cancellation");
}

{
  const dispatcher = createTestDispatcher(() => {
    throw new Error("fetch failed");
  });
  const factory = createFactory(dispatcher, logger);
  const hooks = createHooks();
  const events = await collectEvents(
    await factory.create(descriptor("openai-completions"))(
      sourceModel("openai-completions"),
      { messages: [] },
      {},
      hooks,
    ),
  );
  assert.equal(events.at(-1).error.errorMessage, "network");
  assert.equal(
    hooks.calls.some((call) => call.kind === "failedBeforeDispatch"),
    true,
  );
}

{
  const dispatcher = createTestDispatcher((api, model, context, options) => {
    assert.equal(options.apiKey, undefined);
    assert.equal(options.headers["x-api-key"], "secret-credential:header");
    return completedStream(assistantMessage("stop"));
  });
  const credentials = createCredentials();
  const factory = new PiProviderExecutionFactory({
    dispatcher,
    credentials,
    logger,
  });
  const named = descriptor("google-generative-ai", {
    credentialReference: undefined,
    secretHeaderCredentialReferences: {
      "x-api-key": "credential:header",
    },
  });
  await collectEvents(
    await factory.create(named)(
      sourceModel("google-generative-ai"),
      { messages: [] },
      {},
      createHooks(),
    ),
  );
  assert.deepEqual(credentials.uses, ["credential:header"]);
}

assert.equal(records.some((record) => forbidden.some((value) => record.includes(value))), false);
console.log("runtime Pi Provider execution factory smoke passed");

function createFactory(dispatcher, logger) {
  return new PiProviderExecutionFactory({
    dispatcher,
    credentials: createCredentials(),
    logger,
  });
}

function createCredentials() {
  return {
    uses: [],
    async use(reference, operation) {
      this.uses.push(reference);
      return operation(`secret-${reference}`);
    },
  };
}

function createTestDispatcher(stream = undefined) {
  const calls = [];
  return {
    calls,
    stream(api, model, context, options) {
      calls.push({ api, model, context, options });
      if (stream === undefined) {
        throw new Error("unexpected stream call");
      }
      return stream(api, model, context, options);
    },
  };
}

function descriptor(api, overrides = {}) {
  return {
    schemaVersion: 1,
    source: "application",
    modelProfileId: "profile_1",
    modelConnectionId: "connection_1",
    providerKind: providerKindFor(api),
    api,
    modelId: "model-test",
    parameters: { stopSequences: [] },
    capabilityOverrides: {},
    fallbackProfileIds: [],
    publicHeaders: { "x-public": "public-value" },
    credentialReference: "credential:primary",
    secretHeaderCredentialReferences: {},
    ...overrides,
  };
}

function providerKindFor(api) {
  if (api.startsWith("openai")) return "openai";
  if (api.startsWith("anthropic")) return "anthropic";
  if (api.startsWith("google")) return "google";
  return "openai";
}

function sourceModel(api) {
  return {
    id: "ignored-model",
    name: "Ignored Model",
    api,
    provider: providerKindFor(api),
    baseUrl: "https://provider.example",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 1024,
  };
}

function assistantMessage(stopReason = "stop", errorMessage = undefined) {
  return {
    role: "assistant",
    content: [{ type: "text", text: "assistant response" }],
    api: "openai-completions",
    provider: "openai",
    model: "model-test",
    usage: emptyUsage(),
    stopReason,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function completedStream(finalMessage) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: finalMessage };
      yield { type: "done", reason: finalMessage.stopReason, message: finalMessage };
    },
    result: async () => finalMessage,
  };
}

function errorStream(finalMessage) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "error", reason: finalMessage.stopReason, error: finalMessage };
    },
    result: async () => finalMessage,
  };
}

async function collectEvents(stream) {
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function createHooks() {
  const calls = [];
  return {
    calls,
    async onDispatched(at) {
      calls.push({ kind: "dispatched", at });
    },
    async onFailedBeforeDispatch(at) {
      calls.push({ kind: "failedBeforeDispatch", at });
    },
  };
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
