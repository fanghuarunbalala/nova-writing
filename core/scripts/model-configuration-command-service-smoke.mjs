import assert from "node:assert/strict";
import {
  ApplicationConfiguration,
  CredentialReference,
  MODEL_CONFIGURATION_COMMAND_FAILURE,
  MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
  MODEL_CREDENTIAL_CLEANUP_STATUS,
  MODEL_CREDENTIAL_MUTATION_KIND,
  ModelConfigurationCommandError,
  StorageModelConfigurationCommandService,
  createDefaultApplicationConfiguration,
} from "../dist/index.js";

class MemoryConfigurationStore {
  configuration;
  failNextSave = false;

  constructor(configuration = createDefaultApplicationConfiguration()) {
    this.configuration = configuration;
  }

  async load() {
    return this.configuration;
  }

  async save(configuration, expectedRevision) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw Object.assign(new Error("redacted"), { failure: "write_failed" });
    }
    if (
      expectedRevision !== undefined &&
      this.configuration?.revision !== expectedRevision
    ) {
      throw Object.assign(new Error("redacted"), { failure: "revision_conflict" });
    }
    this.configuration = configuration;
  }
}

class MemoryCredentialStore {
  records = new Map();
  deleted = [];
  failDeleteIds = new Set();

  async getStatus(reference) {
    return this.records.has(reference.id) ? "configured" : "missing";
  }

  async save(reference, secret) {
    this.records.set(reference.id, secret);
  }

  async use(reference, operation) {
    const secret = this.records.get(reference.id);
    if (secret === undefined) throw new Error("missing");
    return operation(secret);
  }

  async delete(reference) {
    if (this.failDeleteIds.has(reference.id)) throw new Error("delete failed");
    this.records.delete(reference.id);
    this.deleted.push(reference.id);
  }
}

class DeterministicIdentities {
  connectionSequence = 0;
  profileSequence = 0;
  credentialSequence = 0;

  generateConnectionId() {
    this.connectionSequence += 1;
    return `connection:test-${this.connectionSequence}`;
  }

  generateModelProfileId() {
    this.profileSequence += 1;
    return `model-profile:test-${this.profileSequence}`;
  }

  generateCredentialReference() {
    this.credentialSequence += 1;
    return new CredentialReference(`credential:test-${this.credentialSequence}`);
  }
}

class CapturingLogger {
  entries = [];

  debug(event, fields) {
    this.entries.push({ level: "debug", event, fields });
  }

  info(event, fields) {
    this.entries.push({ level: "info", event, fields });
  }

  warn(event, fields) {
    this.entries.push({ level: "warn", event, fields });
  }

  error(event, fields) {
    this.entries.push({ level: "error", event, fields });
  }

  child() {
    return this;
  }
}

function request(overrides = {}) {
  return {
    schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
    expectedRevision: 0,
    connection: {
      displayName: "Primary",
      providerKind: "custom",
      baseUrl: "https://provider.invalid/v1",
      enabled: true,
      publicHeaders: {},
      secretHeaderCredentialRefs: {},
    },
    profile: {
      displayName: "Primary Model",
      api: "openai-completions",
      modelId: "model-primary",
      parameters: { stopSequences: [], providerOptions: {} },
      capabilityOverrides: { toolCalling: true },
      fallbackProfileIds: [],
    },
    credential: {
      kind: MODEL_CREDENTIAL_MUTATION_KIND.replace,
      secret: "secret-v1",
    },
    setAsDefault: true,
    ...overrides,
  };
}

const store = new MemoryConfigurationStore();
const credentials = new MemoryCredentialStore();
const identities = new DeterministicIdentities();
const logger = new CapturingLogger();
const service = new StorageModelConfigurationCommandService({
  store,
  credentials,
  identities,
  logger,
});

const created = await service.upsert(request());
assert.equal(created.configuration.revision, 1);
assert.equal(created.connectionId, "connection:test-1");
assert.equal(created.modelProfileId, "model-profile:test-1");
assert.equal(created.credentialStatus, "configured");
assert.equal(
  created.credentialCleanupStatus,
  MODEL_CREDENTIAL_CLEANUP_STATUS.notRequired,
);
assert.equal(created.configuration.defaultModelProfileId, "model-profile:test-1");
assert.equal(credentials.records.get("credential:test-1"), "secret-v1");

const kept = await service.upsert(request({
  expectedRevision: 1,
  connection: {
    ...request().connection,
    id: created.connectionId,
    displayName: "Primary Updated",
  },
  profile: {
    ...request().profile,
    id: created.modelProfileId,
    modelId: "model-primary-updated",
  },
  credential: { kind: MODEL_CREDENTIAL_MUTATION_KIND.keep },
  setAsDefault: false,
}));
assert.equal(kept.configuration.revision, 2);
assert.equal(kept.credentialCleanupStatus, "not_required");
assert.equal(credentials.records.get("credential:test-1"), "secret-v1");

const replaced = await service.upsert(request({
  expectedRevision: 2,
  connection: { ...request().connection, id: created.connectionId },
  profile: { ...request().profile, id: created.modelProfileId },
  credential: {
    kind: MODEL_CREDENTIAL_MUTATION_KIND.replace,
    secret: "secret-v2",
  },
}));
assert.equal(replaced.configuration.revision, 3);
assert.equal(replaced.credentialCleanupStatus, "completed");
assert.equal(credentials.records.has("credential:test-1"), false);
assert.equal(credentials.records.get("credential:test-2"), "secret-v2");

store.failNextSave = true;
await assert.rejects(
  service.upsert(request({
    expectedRevision: 3,
    connection: { ...request().connection, id: created.connectionId },
    profile: { ...request().profile, id: created.modelProfileId },
    credential: {
      kind: MODEL_CREDENTIAL_MUTATION_KIND.replace,
      secret: "staged-secret",
    },
  })),
  /redacted/,
);
assert.equal(store.configuration.revision, 3);
assert.equal(credentials.records.has("credential:test-3"), false);
assert.equal(credentials.deleted.includes("credential:test-3"), true);

const invalidStore = new MemoryConfigurationStore(store.configuration);
const invalidCredentials = new MemoryCredentialStore();
const invalidService = new StorageModelConfigurationCommandService({
  store: invalidStore,
  credentials: invalidCredentials,
  identities: new DeterministicIdentities(),
});
await assert.rejects(
  invalidService.upsert(request({
    expectedRevision: 3,
    profile: {
      ...request().profile,
      id: "model-profile:invalid",
      fallbackProfileIds: ["model-profile:missing"],
    },
  })),
  /unknown fallback Profile/,
);
assert.equal(invalidCredentials.records.size, 0);
assert.deepEqual(invalidCredentials.deleted, ["credential:test-1"]);

const compensationStore = new MemoryConfigurationStore(store.configuration);
compensationStore.failNextSave = true;
const compensationCredentials = new MemoryCredentialStore();
compensationCredentials.failDeleteIds.add("credential:test-1");
const compensationService = new StorageModelConfigurationCommandService({
  store: compensationStore,
  credentials: compensationCredentials,
  identities: new DeterministicIdentities(),
});
await assert.rejects(
  compensationService.upsert(request({ expectedRevision: 3 })),
  (error) =>
    error instanceof ModelConfigurationCommandError &&
    error.failure ===
      MODEL_CONFIGURATION_COMMAND_FAILURE.credentialCompensationFailed,
);
assert.equal(compensationStore.configuration.revision, 3);

credentials.failDeleteIds.add("credential:test-2");
const deferred = await service.upsert(request({
  expectedRevision: 3,
  connection: { ...request().connection, id: created.connectionId },
  profile: { ...request().profile, id: created.modelProfileId },
  credential: {
    kind: MODEL_CREDENTIAL_MUTATION_KIND.replace,
    secret: "secret-v4",
  },
}));
assert.equal(deferred.configuration.revision, 4);
assert.equal(deferred.credentialCleanupStatus, "deferred");
assert.equal(credentials.records.get("credential:test-4"), "secret-v4");

credentials.failDeleteIds.delete("credential:test-4");
const credentialDeleted = await service.upsert(request({
  expectedRevision: 4,
  connection: { ...request().connection, id: created.connectionId },
  profile: { ...request().profile, id: created.modelProfileId },
  credential: { kind: MODEL_CREDENTIAL_MUTATION_KIND.delete },
}));
assert.equal(credentialDeleted.configuration.revision, 5);
assert.equal(credentialDeleted.credentialStatus, "missing");
assert.equal(credentialDeleted.credentialCleanupStatus, "completed");
assert.equal(credentials.records.has("credential:test-4"), false);

await assert.rejects(
  service.setDefault({
    schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
    expectedRevision: 4,
    modelProfileId: created.modelProfileId,
  }),
  (error) =>
    error instanceof ModelConfigurationCommandError &&
    error.failure === MODEL_CONFIGURATION_COMMAND_FAILURE.revisionConflict,
);

const second = await service.upsert(request({
  expectedRevision: 5,
  connection: { ...request().connection, id: created.connectionId },
  profile: {
    ...request().profile,
    id: "model-profile:secondary",
    displayName: "Secondary",
    fallbackProfileIds: [created.modelProfileId],
  },
  credential: { kind: MODEL_CREDENTIAL_MUTATION_KIND.keep },
  setAsDefault: false,
}));
assert.equal(second.configuration.revision, 6);

await assert.rejects(
  service.remove({
    schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
    expectedRevision: 6,
    modelProfileId: created.modelProfileId,
    removeConnectionWhenUnused: true,
  }),
  (error) =>
    error instanceof ModelConfigurationCommandError &&
    error.failure === MODEL_CONFIGURATION_COMMAND_FAILURE.modelProfileReferenced,
);

const removedSecondary = await service.remove({
  schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
  expectedRevision: 6,
  modelProfileId: "model-profile:secondary",
  removeConnectionWhenUnused: true,
});
assert.equal(removedSecondary.configuration.revision, 7);
assert.equal(removedSecondary.removedConnectionId, undefined);

credentials.failDeleteIds.delete("credential:test-4");
const removedPrimary = await service.remove({
  schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
  expectedRevision: 7,
  modelProfileId: created.modelProfileId,
  removeConnectionWhenUnused: true,
});
assert.equal(removedPrimary.configuration.revision, 8);
assert.equal(removedPrimary.removedConnectionId, created.connectionId);
assert.equal(removedPrimary.credentialCleanupStatus, "not_required");
assert.equal(removedPrimary.configuration.defaultModelProfileId, undefined);

const snapshotText = JSON.stringify(store.configuration.toSnapshot());
assert.equal(snapshotText.includes("secret-v1"), false);
assert.equal(snapshotText.includes("secret-v2"), false);
assert.equal(snapshotText.includes("secret-v4"), false);

const sharedDefaults = createDefaultApplicationConfiguration();
const sharedConfiguration = new ApplicationConfiguration({
  ...sharedDefaults.toSnapshot(),
  modelConnections: [
    {
      id: "connection:shared-primary",
      displayName: "Shared Primary",
      providerKind: "openai",
      enabled: true,
      credentialRef: "credential:shared",
      credentialConfigured: true,
      publicHeaders: {},
      secretHeaderCredentialRefs: {},
    },
    {
      id: "connection:shared-secondary",
      displayName: "Shared Secondary",
      providerKind: "openai",
      enabled: true,
      credentialRef: "credential:shared",
      credentialConfigured: true,
      publicHeaders: {},
      secretHeaderCredentialRefs: {},
    },
  ],
  modelProfiles: [
    {
      ...request().profile,
      id: "model-profile:shared-primary",
      connectionId: "connection:shared-primary",
    },
    {
      ...request().profile,
      id: "model-profile:shared-secondary",
      displayName: "Shared Secondary",
      connectionId: "connection:shared-secondary",
    },
  ],
  defaultModelProfileId: "model-profile:shared-primary",
});
const sharedStore = new MemoryConfigurationStore(sharedConfiguration);
const sharedCredentials = new MemoryCredentialStore();
sharedCredentials.records.set("credential:shared", "shared-secret");
const sharedService = new StorageModelConfigurationCommandService({
  store: sharedStore,
  credentials: sharedCredentials,
  identities: new DeterministicIdentities(),
});
const sharedReplacement = await sharedService.upsert(request({
  connection: {
    ...request().connection,
    id: "connection:shared-primary",
    providerKind: "openai",
  },
  profile: {
    ...request().profile,
    id: "model-profile:shared-primary",
  },
  credential: {
    kind: MODEL_CREDENTIAL_MUTATION_KIND.replace,
    secret: "shared-replacement",
  },
}));
assert.equal(sharedReplacement.credentialCleanupStatus, "not_required");
assert.equal(sharedCredentials.records.get("credential:shared"), "shared-secret");

const logText = JSON.stringify(logger.entries);
assert.equal(logText.includes("secret-v1"), false);
assert.equal(logText.includes("secret-v2"), false);
assert.equal(logText.includes("secret-v4"), false);
assert.equal(logText.includes("provider.invalid"), false);
assert.equal(logText.includes("model-primary"), false);
assert.equal(logText.includes("credential:test"), false);

assert.equal(store.configuration instanceof ApplicationConfiguration, true);
console.log("Model Configuration command service smoke passed");
