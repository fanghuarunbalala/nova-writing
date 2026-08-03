import assert from "node:assert/strict";
import { CredentialReference } from "@novel/core";
import {
  DesktopConfigurationIpcController,
  DesktopConfigurationService,
} from "../dist/main/index.js";
import { createElectronPreloadBridge } from "../dist/preload/index.js";

class MemoryConfigurationStore {
  configuration;

  async load() {
    return this.configuration;
  }

  async save(configuration, expectedRevision) {
    if (
      expectedRevision !== undefined &&
      this.configuration?.revision !== expectedRevision
    ) {
      throw new Error("REVISION_CONFLICT");
    }
    this.configuration = configuration;
  }
}

class MemoryCredentialStore {
  values = new Map();

  async getStatus(reference) {
    return this.values.has(reference.id) ? "configured" : "missing";
  }

  async save(reference, secret) {
    this.values.set(reference.id, secret);
  }

  async use(reference, operation) {
    const secret = this.values.get(reference.id);
    if (secret === undefined) throw new Error("MISSING");
    return operation(secret);
  }

  async delete(reference) {
    this.values.delete(reference.id);
  }
}

const configurationStore = new MemoryConfigurationStore();
const credentialStore = new MemoryCredentialStore();
const service = new DesktopConfigurationService({
  store: configurationStore,
  credentials: credentialStore,
});
const initial = await service.load();
assert.equal(initial.revision, 0);
assert.equal(configurationStore.configuration.revision, 0);

const connectionSnapshot = {
  id: "connection.primary",
  displayName: "Primary",
  providerKind: "openai",
  enabled: true,
  credentialRef: "credential:primary",
  credentialConfigured: false,
  publicHeaders: {},
  secretHeaderCredentialRefs: {},
};
const saved = await service.save({
  ...initial,
  revision: 1,
  modelConnections: [connectionSnapshot],
});
assert.equal(saved.modelConnections[0].credentialConfigured, false);
await service.saveCredential("credential:primary", "provider-secret");
assert.equal((await service.load()).modelConnections[0].credentialConfigured, true);
assert.equal(
  await credentialStore.use(
    new CredentialReference("credential:primary"),
    async (secret) => secret.length,
  ),
  "provider-secret".length,
);
await assert.rejects(
  service.saveCredential("credential:unknown", "forbidden"),
  (error) => {
    assert.equal(error.code, "DESKTOP_CONFIGURATION_PROTOCOL_ERROR");
    return true;
  },
);

const handlers = new Map();
const controller = new DesktopConfigurationIpcController({
  service,
  authorizeSender: (senderId) => senderId === 7,
});
controller.register({
  handle(channel, handler) {
    handlers.set(channel, handler);
  },
  removeHandler(channel) {
    handlers.delete(channel);
  },
});
const bridge = createElectronPreloadBridge({
  ipcRenderer: {
    async invoke(channel, ...args) {
      const handler = handlers.get(channel);
      if (handler === undefined) throw new Error("MISSING_HANDLER");
      return handler({ sender: { id: 7 } }, ...args);
    },
  },
});
const loaded = await bridge.configuration.load();
assert.equal(loaded.ok, true);
assert.equal(loaded.value.modelConnections[0].credentialConfigured, true);
const status = await bridge.configuration.getCredentialStatus("credential:primary");
assert.deepEqual(status, { ok: true, value: "configured" });
const deleted = await bridge.configuration.deleteCredential("credential:primary");
assert.equal(deleted.ok, true);
assert.equal(await credentialStore.getStatus(new CredentialReference("credential:primary")), "missing");

await controller.dispose();
assert.equal(handlers.size, 0);
console.log("Electron Configuration Bridge smoke passed");
