import assert from "node:assert/strict";
import { ApplicationSettingsStore } from "../dist/index.js";

const store = new ApplicationSettingsStore({
  modelProviders: [
    {
      id: "provider-initial",
      name: "Initial",
      providerId: "openai",
      api: "openai-responses",
      modelId: "gpt-5",
    },
  ],
});

assert.equal(Object.isFrozen(store.getSnapshot()), true);
assert.equal(Object.isFrozen(store.getSnapshot().modelProviders), true);
assert.equal(store.getSnapshot().activeModelProviderId, "provider-initial");

const added = store.addModelProvider({
  name: " Backup ",
  providerId: " anthropic ",
  api: " anthropic-messages ",
  modelId: " claude-sonnet ",
  baseUrl: " ",
});
assert.equal(added.name, "Backup");
assert.equal(added.baseUrl, undefined);
assert.equal(store.getSnapshot().modelProviders.length, 2);

const updated = store.updateModelProvider(added.id, {
  name: "Backup 2",
  providerId: "anthropic",
  api: "anthropic-messages",
  modelId: "claude-opus",
  baseUrl: "https://example.test",
});
assert.equal(updated.modelId, "claude-opus");
assert.equal(updated.baseUrl, "https://example.test");

store.setActiveModelProvider(added.id);
assert.equal(store.getSnapshot().activeModelProviderId, added.id);
assert.throws(() => store.setActiveModelProvider("missing"), /MODEL_PROVIDER_NOT_FOUND/u);
assert.throws(
  () =>
    store.addModelProvider({
      name: "",
      providerId: "openai",
      api: "openai-responses",
      modelId: "gpt-5",
    }),
  /MODEL_PROVIDER_NAME_REQUIRED/u,
);

console.log("model provider settings store smoke passed");
