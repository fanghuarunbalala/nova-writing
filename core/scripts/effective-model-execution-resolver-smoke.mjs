import assert from "node:assert/strict";
import {
  APPLICATION_CONFIGURATION_SCHEMA_VERSION,
  CONVERSATION_CONFIGURATION_BINDING_SCHEMA_VERSION,
  EFFECTIVE_MODEL_EXECUTION_FAILURE,
  ApplicationConfiguration,
  ConversationConfigurationBinding,
  EffectiveModelExecutionError,
  EffectiveModelExecutionResolver,
  WORKSPACE_CONFIGURATION_SCHEMA_VERSION,
  WorkspaceConfiguration,
  createDefaultApplicationConfiguration,
} from "../dist/index.js";

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
    this.throwOnRead = false;
  }

  async getStatus(reference) {
    if (this.throwOnRead) throw new Error("raw credential failure");
    return this.statuses.get(reference.id) ?? "missing";
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }

  debug(event, fields) {
    this.#capture("debug", event, fields);
  }

  info(event, fields) {
    this.#capture("info", event, fields);
  }

  warn(event, fields) {
    this.#capture("warn", event, fields);
  }

  error(event, fields) {
    this.#capture("error", event, fields);
  }

  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }

  #capture(level, event, fields) {
    this.entries.push({ level, event, fields, bindings: this.bindings });
  }
}

const logger = new CollectingLogger();
const credentials = new MemoryCredentialStatusReader({
  "credential:application": "configured",
  "credential:workspace": "configured",
  "credential:header": "configured",
});
const resolver = new EffectiveModelExecutionResolver({
  credentials,
  supportedApis: ["openai-responses", "anthropic-messages"],
  logger,
});
const application = createApplication();
const workspace = createWorkspace("profile.workspace");
const conversation = createConversation("profile.application");

const applicationResult = await resolver.resolve({
  application: new MemoryApplicationStore(application),
});
assert.equal(applicationResult.source, "application");
assert.equal(applicationResult.modelProfileId, "profile.application");
assert.equal(applicationResult.modelConnectionId, "connection.application");
assert.equal(applicationResult.providerKind, "openai");
assert.equal(applicationResult.api, "openai-responses");
assert.equal(applicationResult.credentialReference.id, "credential:application");
assert.equal(
  applicationResult.secretHeaderCredentialReferences.Authorization.id,
  "credential:header",
);
assert.equal(Object.isFrozen(applicationResult), true);
assert.equal(Object.isFrozen(applicationResult.parameters), true);

const workspaceResult = await resolver.resolve({
  application: new MemoryApplicationStore(application),
  loadWorkspace: async () => workspace,
});
assert.equal(workspaceResult.source, "workspace");
assert.equal(workspaceResult.modelProfileId, "profile.workspace");

const conversationResult = await resolver.resolve({
  application: new MemoryApplicationStore(application),
  loadWorkspace: async () => workspace,
  loadConversation: async () => conversation,
});
assert.equal(conversationResult.source, "conversation");
assert.equal(conversationResult.modelProfileId, "profile.application");

const sessionResult = await resolver.resolve({
  application: new MemoryApplicationStore(application),
  loadWorkspace: async () => workspace,
  loadConversation: async () => conversation,
  loadSession: async () => ({ modelProfileId: "profile.workspace" }),
});
assert.equal(sessionResult.source, "session");
assert.equal(sessionResult.modelProfileId, "profile.workspace");
assert.equal(sessionResult.modelId, "model-workspace");
assert.equal(sessionResult.baseUrl, "https://provider.invalid/v1");

const serialized = JSON.stringify(sessionResult);
assert.equal(serialized.includes("provider-secret-value"), false);
assert.equal(serialized.includes("credential:workspace"), true);

await assertFailure(
  resolver.resolve({ application: new MemoryApplicationStore(undefined) }),
  EFFECTIVE_MODEL_EXECUTION_FAILURE.applicationConfigurationMissing,
  false,
);
await assertFailure(
  resolver.resolve({
    application: { load: async () => { throw new Error("raw config failure"); } },
  }),
  EFFECTIVE_MODEL_EXECUTION_FAILURE.configurationUnavailable,
  true,
);
await assertFailure(
  resolver.resolve({
    application: new MemoryApplicationStore(createDefaultApplicationConfiguration()),
  }),
  EFFECTIVE_MODEL_EXECUTION_FAILURE.modelProfileUnselected,
  false,
);
await assertFailure(
  resolver.resolve({
    application: new MemoryApplicationStore(application),
    loadSession: async () => ({ modelProfileId: "profile.unknown" }),
  }),
  EFFECTIVE_MODEL_EXECUTION_FAILURE.modelProfileMissing,
  false,
);
await assertFailure(
  resolver.resolve({
    application: new MemoryApplicationStore({
      defaultModelProfileId: "profile.orphan",
      getModelProfile: () => ({ id: "profile.orphan", connectionId: "missing" }),
      getModelConnection: () => undefined,
    }),
  }),
  EFFECTIVE_MODEL_EXECUTION_FAILURE.modelConnectionMissing,
  false,
);
await assertFailure(
  resolver.resolve({
    application: new MemoryApplicationStore(createSingleApplication({ enabled: false })),
  }),
  EFFECTIVE_MODEL_EXECUTION_FAILURE.modelConnectionDisabled,
  false,
);
await assertFailure(
  resolver.resolve({
    application: new MemoryApplicationStore(createSingleApplication({ api: "custom-api" })),
  }),
  EFFECTIVE_MODEL_EXECUTION_FAILURE.modelApiUnsupported,
  false,
);
await assertFailure(
  resolver.resolve({
    application: new MemoryApplicationStore(createSingleApplication({
      credentialRef: undefined,
      secretHeaderCredentialRefs: {},
    })),
  }),
  EFFECTIVE_MODEL_EXECUTION_FAILURE.credentialReferenceMissing,
  false,
);

const missingCredentials = new MemoryCredentialStatusReader();
await assertFailure(
  new EffectiveModelExecutionResolver({
    credentials: missingCredentials,
    supportedApis: ["openai-responses"],
  }).resolve({
    application: new MemoryApplicationStore(createSingleApplication()),
  }),
  EFFECTIVE_MODEL_EXECUTION_FAILURE.credentialMissing,
  true,
);
const unavailableCredentials = new MemoryCredentialStatusReader({
  "credential:single": "unavailable",
});
await assertFailure(
  new EffectiveModelExecutionResolver({
    credentials: unavailableCredentials,
    supportedApis: ["openai-responses"],
  }).resolve({
    application: new MemoryApplicationStore(createSingleApplication()),
  }),
  EFFECTIVE_MODEL_EXECUTION_FAILURE.credentialUnavailable,
  true,
);
const missingHeaderCredentials = new MemoryCredentialStatusReader({
  "credential:single": "configured",
});
await assertFailure(
  new EffectiveModelExecutionResolver({
    credentials: missingHeaderCredentials,
    supportedApis: ["openai-responses"],
  }).resolve({
    application: new MemoryApplicationStore(createSingleApplication({
      secretHeaderCredentialRefs: { Authorization: "credential:missing-header" },
    })),
  }),
  EFFECTIVE_MODEL_EXECUTION_FAILURE.credentialMissing,
  true,
);
unavailableCredentials.throwOnRead = true;
await assertFailure(
  new EffectiveModelExecutionResolver({
    credentials: unavailableCredentials,
    supportedApis: ["openai-responses"],
  }).resolve({
    application: new MemoryApplicationStore(createSingleApplication()),
  }),
  EFFECTIVE_MODEL_EXECUTION_FAILURE.credentialUnavailable,
  true,
);

const serializedLogs = JSON.stringify(logger.entries);
for (const forbidden of [
  "model-application",
  "model-workspace",
  "https://provider.invalid/v1",
  "credential:application",
  "credential:workspace",
  "provider-secret-value",
  "raw config failure",
  "raw credential failure",
]) {
  assert.equal(serializedLogs.includes(forbidden), false, forbidden);
}

console.log("Effective Model Execution Resolver smoke passed");

function createApplication() {
  const defaults = createDefaultApplicationConfiguration().toSnapshot();
  return new ApplicationConfiguration({
    ...defaults,
    schemaVersion: APPLICATION_CONFIGURATION_SCHEMA_VERSION,
    modelConnections: [
      connection({
        id: "connection.application",
        providerKind: "openai",
        credentialRef: "credential:application",
        secretHeaderCredentialRefs: {
          Authorization: "credential:header",
          Duplicate: "credential:application",
        },
      }),
      connection({
        id: "connection.workspace",
        providerKind: "anthropic",
        baseUrl: "https://provider.invalid/v1",
        credentialRef: "credential:workspace",
      }),
    ],
    modelProfiles: [
      profile({
        id: "profile.application",
        connectionId: "connection.application",
        api: "openai-responses",
        modelId: "model-application",
      }),
      profile({
        id: "profile.workspace",
        connectionId: "connection.workspace",
        api: "anthropic-messages",
        modelId: "model-workspace",
      }),
    ],
    defaultModelProfileId: "profile.application",
  });
}

function createSingleApplication(options = {}) {
  const defaults = createDefaultApplicationConfiguration().toSnapshot();
  const hasCredentialRef = Object.hasOwn(options, "credentialRef");
  return new ApplicationConfiguration({
    ...defaults,
    modelConnections: [connection({
      id: "connection.single",
      providerKind: "openai",
      enabled: options.enabled ?? true,
      credentialRef: hasCredentialRef
        ? options.credentialRef
        : "credential:single",
      secretHeaderCredentialRefs: options.secretHeaderCredentialRefs ?? {},
    })],
    modelProfiles: [profile({
      id: "profile.single",
      connectionId: "connection.single",
      api: options.api ?? "openai-responses",
      modelId: "model-single",
    })],
    defaultModelProfileId: "profile.single",
  });
}

function connection(options) {
  return {
    id: options.id,
    displayName: options.id,
    providerKind: options.providerKind,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    enabled: options.enabled ?? true,
    ...(options.credentialRef === undefined
      ? {}
      : { credentialRef: options.credentialRef }),
    credentialConfigured: false,
    publicHeaders: { "X-Novel-Test": "public" },
    secretHeaderCredentialRefs: options.secretHeaderCredentialRefs ?? {},
  };
}

function profile(options) {
  return {
    id: options.id,
    displayName: options.id,
    connectionId: options.connectionId,
    api: options.api,
    modelId: options.modelId,
    parameters: {
      temperature: 0.5,
      stopSequences: [],
      providerOptions: {},
    },
    capabilityOverrides: { toolCalling: true },
    fallbackProfileIds: [],
  };
}

function createWorkspace(defaultModelProfileId) {
  return new WorkspaceConfiguration({
    schemaVersion: WORKSPACE_CONFIGURATION_SCHEMA_VERSION,
    revision: 0,
    workspaceId: "workspace:model-resolution",
    defaultAgentType: "novel_agent",
    defaultModelProfileId,
    defaultRuntimeProfileId: "default",
    defaultToolPermissionProfileId: "default",
    subagentsEnabled: true,
    autosaveEnabled: true,
    automaticBackupEnabled: true,
    restoreConversationsOnOpen: true,
    prepareRuntimeHostOnOpen: true,
    allowToolsOutsideWorkspace: false,
    recoverDraftsAutomatically: true,
    draftRetentionDays: 30,
    artifactLimitBytes: 10_737_418_240,
    cacheLimitBytes: 2_147_483_648,
  });
}

function createConversation(modelProfileId) {
  return new ConversationConfigurationBinding({
    schemaVersion: CONVERSATION_CONFIGURATION_BINDING_SCHEMA_VERSION,
    conversationId: "conversation:model-resolution",
    modelProfileId,
    outputVerbosity: "balanced",
  });
}

async function assertFailure(operation, expectedFailure, retryable) {
  await assert.rejects(operation, (error) => {
    assert.equal(error instanceof EffectiveModelExecutionError, true);
    assert.equal(error.failure, expectedFailure);
    assert.equal(error.retryable, retryable);
    return true;
  });
}
