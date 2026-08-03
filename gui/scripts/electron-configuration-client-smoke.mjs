import assert from "node:assert/strict";
import { createDefaultApplicationConfiguration } from "../../core/dist/index.js";
import {
  ElectronApplicationConfigurationClient,
  ElectronApplicationConfigurationClientError,
  createDesktopRendererComposition,
} from "../dist/renderer/index.js";

const snapshot = createDefaultApplicationConfiguration().toSnapshot();
const configuration = {
  load: async () => success(snapshot),
  save: async (value) => success(value),
  getCredentialStatus: async () => success("missing"),
  saveCredential: async () => success({ acknowledged: true }),
  deleteCredential: async () => success({ acknowledged: true }),
};
const client = new ElectronApplicationConfigurationClient(configuration);
assert.equal((await client.load()).revision, 0);
assert.equal(await client.getCredentialStatus("credential:model"), "missing");
await client.saveCredential("credential:model", "private-secret");

const composition = createDesktopRendererComposition({
  window: {
    novelDesktop: {
      configuration,
      request: async (request) =>
        success({
          protocolVersion: request.protocolVersion,
          requestId: request.requestId,
          ok: true,
          data: null,
        }),
      cancelRequest: async () => success({ acknowledged: true }),
      openSubscription: async () => success({ acknowledged: true }),
      readSubscription: async () => success({ done: true }),
      closeSubscription: async () => success({ acknowledged: true }),
    },
  },
});
assert.ok(composition.configurationClient);
assert.equal((await composition.configurationClient.load()).revision, 0);
await composition.transport.close();

const failed = new ElectronApplicationConfigurationClient({
  ...configuration,
  load: async () => ({
    ok: false,
    error: { code: "CONFIGURATION_UNAVAILABLE", retryable: true },
  }),
});
await assert.rejects(
  failed.load(),
  (error) =>
    error instanceof ElectronApplicationConfigurationClientError &&
    error.code === "CONFIGURATION_UNAVAILABLE" &&
    error.retryable,
);

console.log("electron configuration client smoke passed");

function success(value) {
  return { ok: true, value };
}
