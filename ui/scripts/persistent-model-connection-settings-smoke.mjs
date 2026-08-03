import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import {
  ApplicationConfiguration,
  createDefaultApplicationConfiguration,
} from "../../core/dist/index.js";
import {
  ApplicationSettingsStore,
  ModelProviderSettingsPanel,
} from "../dist/index.js";

installDom();
class MemoryApplicationConfigurationClient {
  snapshot = createDefaultApplicationConfiguration().toSnapshot();
  credentials = new Map();
  savedSecrets = [];
  savedSnapshots = [];

  async load() {
    return this.projectCredentials(this.snapshot);
  }

  async save(snapshot) {
    this.snapshot = new ApplicationConfiguration(snapshot).toSnapshot();
    this.savedSnapshots.push(this.snapshot);
    return this.projectCredentials(this.snapshot);
  }

  async getCredentialStatus(credentialRef) {
    return this.credentials.has(credentialRef) ? "configured" : "missing";
  }

  async saveCredential(credentialRef, secret) {
    this.savedSecrets.push({ credentialRef, secret });
    this.credentials.set(credentialRef, secret);
  }

  async deleteCredential(credentialRef) {
    this.credentials.delete(credentialRef);
  }

  projectCredentials(snapshot) {
    return Object.freeze({
      ...snapshot,
      modelConnections: Object.freeze(
        snapshot.modelConnections.map((connection) =>
          Object.freeze({
            ...connection,
            credentialConfigured:
              connection.credentialRef !== undefined &&
              this.credentials.has(connection.credentialRef),
          }),
        ),
      ),
    });
  }
}

const client = new MemoryApplicationConfigurationClient();
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);

await act(async () => {
  root.render(
    createElement(ModelProviderSettingsPanel, {
      configuration: client,
      store: new ApplicationSettingsStore(),
    }),
  );
});
await waitForReact(() => container.textContent.includes("配置已加载"));
await clickButton("新增模型连接");
assert.equal(container.querySelector('[aria-label="Provider ID"]'), null);
assert.ok(container.querySelector('[aria-label="API Key"][type="password"]'));
const protocol = container.querySelector('[aria-label="API 协议"]');
assert.ok(protocol);
assert.equal(protocol.value, "openai-responses");
assert.equal(
  [...protocol.options].some((option) => option.value === "anthropic-messages"),
  true,
);
await setSelect("服务商", "anthropic");
assert.equal(protocol.value, "anthropic-messages");
await setField("API Key", "secret-openai-key");
await clickButton("保存并设为默认模型");
await waitForReact(() => container.textContent.includes("模型连接保存成功"));

assert.equal(client.savedSecrets.length, 1);
assert.equal(client.savedSecrets[0].secret, "secret-openai-key");
assert.equal(
  client.savedSnapshots[0].modelConnections[0].credentialConfigured,
  false,
);
assert.equal(client.snapshot.modelConnections.length, 1);
assert.equal(client.snapshot.modelProfiles.length, 1);
assert.equal(client.snapshot.modelConnections[0].providerKind, "anthropic");
assert.equal(client.snapshot.modelConnections[0].displayName, "OpenAI 主力模型");
assert.equal(client.snapshot.modelProfiles[0].api, "anthropic-messages");
assert.equal(client.snapshot.modelProfiles[0].modelId, "gpt-5");
assert.equal(
  client.snapshot.defaultModelProfileId,
  client.snapshot.modelProfiles[0].id,
);
assert.equal(JSON.stringify(client.snapshot).includes("secret-openai-key"), false);
assert.match(container.textContent, /API Key 已配置/u);
assert.equal(container.querySelector('[aria-label="API Key"]'), null);

await clickButton("编辑");
const editKey = container.querySelector('[aria-label="API Key"]');
assert.ok(editKey);
assert.equal(editKey.value, "");
assert.match(editKey.placeholder, /保持现有 API Key/u);
await setField("显示名称", "OpenAI 默认连接");
await clickButton("保存并设为默认模型");
await waitForReact(() => container.textContent.includes("OpenAI 默认连接"));
assert.equal(client.savedSecrets.length, 1);
assert.equal(
  client.savedSnapshots[1].modelConnections[0].credentialConfigured,
  false,
);

await act(async () => root.unmount());
console.log("persistent model connection settings smoke passed");

async function clickButton(label) {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent.includes(label),
  );
  assert.ok(button, `missing button: ${label}`);
  await act(async () => button.click());
}

async function setField(label, value) {
  const field = container.querySelector(`input[aria-label="${label}"]`);
  assert.ok(field, `missing field: ${label}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(field, value);
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function setSelect(label, value) {
  const field = container.querySelector(`select[aria-label="${label}"]`);
  assert.ok(field, `missing select: ${label}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    ).set;
    setter.call(field, value);
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

async function waitForReact(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for React state");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    pretendToBeVisual: true,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}
