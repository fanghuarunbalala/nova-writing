import {
  APPLICATION_CONFIGURATION_SCHEMA_VERSION,
  ApplicationConfiguration,
  createDefaultApplicationConfiguration,
} from "../../dist/index.js";
import {
  PiRuntimeChildAdapterFactory,
  runDesktopRuntimeChildEntrypoint,
} from "../../dist/node/index.js";

const application = createConfiguredApplication();
const credentials = fakeCredentials();
const applicationStore = {
  async load() {
    return application;
  },
  async save() {},
};

await runDesktopRuntimeChildEntrypoint({
  application: applicationStore,
  credentials,
  adapterFactory: new PiRuntimeChildAdapterFactory({
    application: applicationStore,
    credentials,
    providerExecutionFactory: {
      create: () => async () => completedStream(assistantMessage("stop")),
    },
  }),
});

function createConfiguredApplication() {
  const defaults = createDefaultApplicationConfiguration().toSnapshot();
  return new ApplicationConfiguration({
    ...defaults,
    schemaVersion: APPLICATION_CONFIGURATION_SCHEMA_VERSION,
    modelConnections: [
      {
        id: "connection.e2e",
        displayName: "E2E Connection",
        providerKind: "openai",
        enabled: true,
        credentialRef: "credential:e2e",
        credentialConfigured: false,
        publicHeaders: {},
        secretHeaderCredentialRefs: {},
      },
    ],
    modelProfiles: [
      {
        id: "profile.e2e",
        displayName: "E2E Profile",
        connectionId: "connection.e2e",
        api: "openai-responses",
        modelId: "e2e-model",
        parameters: { stopSequences: [], providerOptions: {} },
        capabilityOverrides: { toolCalling: true },
        fallbackProfileIds: [],
      },
    ],
    defaultModelProfileId: "profile.e2e",
  });
}

function fakeCredentials() {
  return {
    async use(reference, operation) {
      return operation(`secret-${reference}`);
    },
    async getStatus() {
      return "configured";
    },
    async save() {},
    async delete() {},
  };
}

function assistantMessage(stopReason = "stop") {
  return {
    role: "assistant",
    content: [{ type: "text", text: "e2e assistant response" }],
    api: "openai-completions",
    provider: "openai",
    model: "e2e-model",
    usage: emptyUsage(),
    stopReason,
    timestamp: Date.parse("2026-08-04T12:00:01.000Z"),
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
