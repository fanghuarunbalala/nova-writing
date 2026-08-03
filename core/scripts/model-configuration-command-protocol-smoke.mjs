import assert from "node:assert/strict";
import {
  MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
  MODEL_CREDENTIAL_MUTATION_KIND,
  captureRemoveModelConfigurationRequest,
  captureSetDefaultModelProfileRequest,
  captureUpsertModelConfigurationRequest,
} from "../dist/index.js";

const replacementSecret = "provider-secret-value";
const upsert = captureUpsertModelConfigurationRequest({
  schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
  expectedRevision: 4,
  connection: {
    displayName: "Custom Primary",
    providerKind: "custom",
    baseUrl: "https://provider.invalid/v1",
    enabled: true,
    publicHeaders: { "X-Client": "novel" },
    secretHeaderCredentialRefs: {},
  },
  profile: {
    displayName: "Primary Model",
    api: "openai-completions",
    modelId: "model-primary",
    parameters: {
      reasoningEffort: "medium",
      stopSequences: [],
      providerOptions: {},
    },
    capabilityOverrides: { toolCalling: true },
    fallbackProfileIds: [],
  },
  credential: {
    kind: MODEL_CREDENTIAL_MUTATION_KIND.replace,
    secret: replacementSecret,
  },
  setAsDefault: true,
});

assert.equal(upsert.expectedRevision, 4);
assert.equal(upsert.connection.providerKind, "custom");
assert.equal(upsert.profile.api, "openai-completions");
assert.equal(upsert.credential.kind, "replace");
assert.equal(Object.isFrozen(upsert), true);
assert.equal(Object.isFrozen(upsert.connection), true);
assert.equal(Object.isFrozen(upsert.profile), true);
assert.equal(Object.isFrozen(upsert.profile.parameters), true);

const keep = captureUpsertModelConfigurationRequest({
  ...upsert,
  connection: { ...upsert.connection, id: "connection:primary" },
  profile: { ...upsert.profile, id: "model-profile:primary" },
  credential: { kind: MODEL_CREDENTIAL_MUTATION_KIND.keep },
});
assert.deepEqual(keep.credential, { kind: "keep" });

const remove = captureRemoveModelConfigurationRequest({
  schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
  expectedRevision: 5,
  modelProfileId: "model-profile:primary",
  removeConnectionWhenUnused: true,
});
assert.equal(remove.removeConnectionWhenUnused, true);

const setDefault = captureSetDefaultModelProfileRequest({
  schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
  expectedRevision: 5,
  modelProfileId: "model-profile:primary",
});
assert.equal(setDefault.modelProfileId, "model-profile:primary");

assert.throws(
  () => captureUpsertModelConfigurationRequest({ ...upsert, schemaVersion: 2 }),
  /schema version is unsupported/,
);
assert.throws(
  () => captureUpsertModelConfigurationRequest({
    ...upsert,
    connection: { ...upsert.connection, baseUrl: undefined },
  }),
  /requires a Base URL/,
);
assert.throws(
  () => captureUpsertModelConfigurationRequest({
    ...upsert,
    credential: { kind: "replace", secret: "" },
  }),
  /secret is invalid/,
);
assert.throws(
  () => captureRemoveModelConfigurationRequest({
    ...remove,
    expectedRevision: -1,
  }),
  /revision is invalid/,
);

const safeResult = {
  schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
  configuration: { revision: 5 },
  connectionId: "connection:primary",
  modelProfileId: "model-profile:primary",
  credentialStatus: "configured",
  credentialCleanupStatus: "not_required",
};
assert.equal(JSON.stringify(safeResult).includes(replacementSecret), false);
assert.equal(JSON.stringify(safeResult).includes("secret"), false);

console.log("Model Configuration command protocol smoke passed");
