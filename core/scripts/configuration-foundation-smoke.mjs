import assert from "node:assert/strict";
import {
  APPLICATION_CONFIGURATION_SCHEMA_VERSION,
  CONVERSATION_CONFIGURATION_BINDING_SCHEMA_VERSION,
  ApplicationConfiguration,
  ConversationConfigurationBinding,
  EffectiveConfigurationResolver,
  SettingDefinition,
  WORKSPACE_CONFIGURATION_SCHEMA_VERSION,
  WorkspaceConfiguration,
  createDefaultApplicationConfiguration,
} from "../dist/index.js";

const defaults = createDefaultApplicationConfiguration();
assert.equal(defaults.schemaVersion, APPLICATION_CONFIGURATION_SCHEMA_VERSION);
assert.equal(defaults.defaultRuntimeProfileId, "default");
assert.equal(defaults.getRuntimeProfile("default")?.nudge.maximumPerProviderCall, 2);
assert.equal(defaults.getToolPermissionProfile("default")?.approvalMode, "ask_on_write");
assert.equal(Object.isFrozen(defaults), true);
assert.equal(Object.isFrozen(defaults.toSnapshot()), true);

const defaultSnapshot = defaults.toSnapshot();
const application = new ApplicationConfiguration({
  ...defaultSnapshot,
  revision: 7,
  modelConnections: [
    {
      id: "connection.primary",
      displayName: "Primary",
      providerKind: "openai",
      enabled: true,
      credentialRef: "credential:primary",
      credentialConfigured: true,
      publicHeaders: { "X-Novel-Client": "desktop" },
      secretHeaderCredentialRefs: {
        Authorization: "credential:primary-authorization",
      },
    },
    {
      id: "connection.secondary",
      displayName: "Secondary",
      providerKind: "anthropic",
      enabled: true,
      credentialRef: "credential:secondary",
      credentialConfigured: true,
      publicHeaders: {},
      secretHeaderCredentialRefs: {},
    },
  ],
  modelProfiles: [
    {
      id: "model.primary",
      displayName: "Primary Model",
      connectionId: "connection.primary",
      modelId: "model-a",
      parameters: {
        reasoningEffort: "medium",
        stopSequences: [],
        providerOptions: {},
      },
      capabilityOverrides: { toolCalling: true },
      fallbackProfileIds: ["model.secondary"],
    },
    {
      id: "model.secondary",
      displayName: "Secondary Model",
      connectionId: "connection.secondary",
      modelId: "model-b",
      parameters: { stopSequences: [], providerOptions: {} },
      capabilityOverrides: {},
      fallbackProfileIds: [],
    },
  ],
  defaultModelProfileId: "model.primary",
});

const workspace = new WorkspaceConfiguration({
  schemaVersion: WORKSPACE_CONFIGURATION_SCHEMA_VERSION,
  revision: 3,
  workspaceId: "workspace:novel",
  displayName: "Novel",
  defaultModelProfileId: "model.secondary",
  defaultRuntimeProfileId: "default",
  defaultToolPermissionProfileId: "default",
  subagentsEnabled: false,
  autosaveEnabled: true,
  automaticBackupEnabled: true,
  restoreConversationsOnOpen: true,
  prepareRuntimeHostOnOpen: true,
  allowToolsOutsideWorkspace: true,
  recoverDraftsAutomatically: true,
  draftRetentionDays: 30,
  artifactLimitBytes: 10_737_418_240,
  cacheLimitBytes: 2_147_483_648,
});
const conversation = new ConversationConfigurationBinding({
  schemaVersion: CONVERSATION_CONFIGURATION_BINDING_SCHEMA_VERSION,
  conversationId: "conversation:novel",
  agentType: "novel_agent",
  modelProfileId: "model.primary",
  responseLanguage: "zh-CN",
  subagentsEnabled: true,
  outputVerbosity: "detailed",
});
const effective = new EffectiveConfigurationResolver().resolve({
  application,
  workspace,
  conversation,
  session: {
    modelProfileId: "model.secondary",
    subagentsEnabled: false,
    outputVerbosity: "concise",
  },
});

assert.equal(effective.modelProfile?.id, "model.secondary");
assert.equal(effective.modelConnection?.id, "connection.secondary");
assert.equal(effective.sources.modelProfile, "session");
assert.equal(effective.responseLanguage, "zh-CN");
assert.equal(effective.sources.responseLanguage, "conversation");
assert.equal(effective.subagentsEnabled, false);
assert.equal(effective.sources.subagentsEnabled, "session");
assert.equal(effective.outputVerbosity, "concise");
assert.equal(effective.allowToolsOutsideWorkspace, false);

const serialized = JSON.stringify(application.toSnapshot());
assert.equal(serialized.includes("credential:primary"), true);
assert.equal(serialized.includes("sk-"), false);
assert.equal(serialized.includes("apiKey"), false);

assert.throws(
  () => new ApplicationConfiguration({
    ...application.toSnapshot(),
    modelProfiles: [{
      ...application.modelProfiles[0].toSnapshot(),
      connectionId: "connection.unknown",
    }],
    defaultModelProfileId: "model.primary",
  }),
  /unknown Model Connection/,
);
assert.throws(
  () => new ApplicationConfiguration({
    ...application.toSnapshot(),
    modelProfiles: [
      {
        ...application.modelProfiles[0].toSnapshot(),
        fallbackProfileIds: ["model.secondary"],
      },
      {
        ...application.modelProfiles[1].toSnapshot(),
        fallbackProfileIds: ["model.primary"],
      },
    ],
  }),
  /fallback cycle/,
);
assert.throws(
  () => new EffectiveConfigurationResolver().resolve({
    application,
    session: { runtimeProfileId: "runtime.unknown" },
  }),
  /Runtime Profile is unknown/,
);

const setting = new SettingDefinition({
  id: "model.connection.api_key",
  label: "API Key",
  description: "Credential supplied to one Model Connection.",
  scopes: ["application"],
  applyMode: "next_provider_call",
  sensitivity: "secret",
  advanced: false,
});
assert.equal(setting.sensitivity, "secret");
assert.equal(setting.applyMode, "next_provider_call");
assert.equal(Object.isFrozen(setting), true);

console.log("Configuration foundation smoke passed");
