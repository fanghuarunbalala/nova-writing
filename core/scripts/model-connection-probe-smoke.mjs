import assert from "node:assert/strict";
import {
  APPLICATION_CONFIGURATION_SCHEMA_VERSION,
  EffectiveModelExecutionError,
  EffectiveModelExecutionResolver,
  ApplicationConfiguration,
  createDefaultApplicationConfiguration,
} from "../dist/index.js";
import { ModelConnectionProbeService } from "../dist/node/index.js";

class MemoryApplicationStore {
  constructor(configuration) {
    this.configuration = configuration;
  }

  async load() {
    return this.configuration;
  }

  async save(configuration) {
    this.configuration = configuration;
  }
}

class MemoryCredentialStatusReader {
  constructor(statuses = {}) {
    this.statuses = new Map(Object.entries(statuses));
  }

  async getStatus(reference) {
    return this.statuses.get(reference.id) ?? "missing";
  }
}

const records = [];
const logger = createLogger(records);
const credentials = fakeCredentials();

const successResult = await runProbe({
  resolver: { resolve: async () => descriptor("openai-responses") },
  factory: { create: () => async () => completedStream(assistantMessage("stop")) },
});
assert.equal(successResult.ok, true);
assert.equal(typeof successResult.latencyMs, "number");
assert.ok(successResult.latencyMs >= 0);

const failureCases = [
  ["rate_limit", "rate_limit"],
  ["cancellation", "cancellation"],
  ["raw provider failure text", "network"],
];
for (const [errorMessage, expected] of failureCases) {
  const result = await runProbe({
    resolver: { resolve: async () => descriptor("openai-responses") },
    factory: {
      create: () => async () =>
        errorStream(assistantMessage("error", errorMessage)),
    },
  });
  assert.deepEqual(result, { ok: false, failure: expected });
}

{
  const result = await runProbe({
    resolver: { resolve: async () => descriptor("openai-responses") },
    factory: {
      create: () => async () => {
        throw new Error("fetch failed");
      },
    },
  });
  assert.deepEqual(result, { ok: false, failure: "network" });
}

{
  const result = await runProbe({
    resolver: {
      resolve: async () => {
        throw new EffectiveModelExecutionError("model_profile_missing");
      },
    },
    factory: { create: () => async () => completedStream(assistantMessage("stop")) },
  });
  assert.deepEqual(result, { ok: false, failure: "model_profile_missing" });
}

{
  const result = await runProbe({
    resolver: {
      resolve: async () => {
        throw new Error("unexpected resolution failure");
      },
    },
    factory: { create: () => async () => completedStream(assistantMessage("stop")) },
  });
  assert.deepEqual(result, { ok: false, failure: "configuration_unavailable" });
}

const realResolver = new EffectiveModelExecutionResolver({
  credentials: new MemoryCredentialStatusReader({
    "credential:application": "configured",
  }),
  supportedApis: ["openai-responses"],
});
const realResult = await new ModelConnectionProbeService({
  application: new MemoryApplicationStore(createApplication()),
  credentials,
  resolver: realResolver,
  executionFactory: {
    create: () => async () => completedStream(assistantMessage("stop")),
  },
  logger,
}).probe();
assert.equal(realResult.ok, true);

const emptyResult = await new ModelConnectionProbeService({
  application: new MemoryApplicationStore(
    createDefaultApplicationConfiguration().toSnapshot(),
  ),
  credentials,
  resolver: new EffectiveModelExecutionResolver({
    credentials: new MemoryCredentialStatusReader({}),
    supportedApis: ["openai-responses"],
  }),
  executionFactory: {
    create: () => async () => completedStream(assistantMessage("stop")),
  },
  logger,
}).probe();
assert.deepEqual(emptyResult, {
  ok: false,
  failure: "model_profile_unselected",
});

const serializedLogs = JSON.stringify(records);
for (const forbidden of [
  "model-probe",
  "https://provider.invalid",
  "secret-",
  "raw provider failure text",
  "fetch failed",
]) {
  assert.equal(serializedLogs.includes(forbidden), false);
}

console.log("Model Connection probe smoke passed");

async function runProbe({ resolver, factory }) {
  const service = new ModelConnectionProbeService({
    application: {
      load: async () => createDefaultApplicationConfiguration().toSnapshot(),
    },
    credentials,
    resolver,
    executionFactory: factory,
    logger,
  });
  return service.probe();
}

function descriptor(api) {
  return {
    schemaVersion: 1,
    source: "application",
    modelProfileId: "profile.probe",
    modelConnectionId: "connection.probe",
    providerKind: "openai",
    api,
    modelId: "model-probe",
    baseUrl: "https://provider.invalid/v1",
    parameters: { stopSequences: [] },
    capabilityOverrides: {},
    fallbackProfileIds: [],
    publicHeaders: { "X-Novel-Test": "public" },
    credentialReference: "credential:probe",
    secretHeaderCredentialReferences: {},
  };
}

function createApplication() {
  const defaults = createDefaultApplicationConfiguration().toSnapshot();
  return new ApplicationConfiguration({
    ...defaults,
    schemaVersion: APPLICATION_CONFIGURATION_SCHEMA_VERSION,
    modelConnections: [
      {
        id: "connection.application",
        displayName: "Connection",
        providerKind: "openai",
        enabled: true,
        credentialRef: "credential:application",
        credentialConfigured: false,
        publicHeaders: { "X-Novel-Test": "public" },
        secretHeaderCredentialRefs: {},
      },
    ],
    modelProfiles: [
      {
        id: "profile.application",
        displayName: "Profile",
        connectionId: "connection.application",
        api: "openai-responses",
        modelId: "model-application",
        parameters: { stopSequences: [], providerOptions: {} },
        capabilityOverrides: { toolCalling: true },
        fallbackProfileIds: [],
      },
    ],
    defaultModelProfileId: "profile.application",
  });
}

function fakeCredentials() {
  return {
    uses: [],
    async use(reference, operation) {
      this.uses.push(reference);
      return operation(`secret-${reference}`);
    },
    async getStatus() {
      return "configured";
    },
  };
}

function assistantMessage(stopReason = "stop", errorMessage = undefined) {
  return {
    role: "assistant",
    content: [{ type: "text", text: "probe response" }],
    api: "openai-completions",
    provider: "openai",
    model: "model-probe",
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
