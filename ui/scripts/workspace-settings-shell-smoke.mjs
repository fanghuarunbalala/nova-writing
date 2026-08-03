import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { DefaultNovelApiClient } from "../../core/dist/index.js";
import {
  DeterministicMockNovelHost,
  MockElectronApiTransport,
} from "../../core/dist/testing/index.js";
import {
  ApplicationSettingsStore,
  ApplicationShellStore,
  NovelApp,
  WorkspaceController,
} from "../dist/index.js";

installDom();
const host = new DeterministicMockNovelHost();
const transport = new MockElectronApiTransport({ host });
const api = new DefaultNovelApiClient({ transport });
const shellStore = new ApplicationShellStore();
const settingsStore = new ApplicationSettingsStore();
const calls = { picks: 0, opens: [], closes: 0 };
const serialization = [];
let releaseFirstList;
const firstListBlocked = new Promise((resolve) => {
  releaseFirstList = resolve;
});
let listCall = 0;
const controller = new WorkspaceController({
  picker: {
    pickWorkspace: async () => {
      calls.picks += 1;
      return { referenceId: "workspace-new", label: "星海计划" };
    },
  },
  sessions: {
    listRecent: async () => {
      listCall += 1;
      serialization.push(`list:${listCall}:start`);
      if (listCall === 1) await firstListBlocked;
      serialization.push(`list:${listCall}:end`);
      return [{ id: "workspace-recent", label: "旧项目" }];
    },
    open: async (reference) => {
      calls.opens.push(reference.referenceId);
      return { id: reference.referenceId, label: reference.label };
    },
    close: async () => {
      calls.closes += 1;
    },
  },
});
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);

function ExtensionSettings() {
  return createElement("div", { "data-extension-settings": true }, "扩展设置");
}

await act(async () => {
  root.render(
    createElement(NovelApp, {
      api,
      platform: createPlatform(),
      shellStore,
      settingsStore,
      workspaceController: controller,
      shell: {
        overlays: createElement("div", { "data-custom-overlay": true }),
      },
      extensions: {
        settingsSections: [
          { id: "test.extension", title: "扩展", component: ExtensionSettings },
        ],
      },
    }),
  );
});
const firstRefresh = controller.refresh();
const secondRefresh = controller.refresh();
await Promise.resolve();
assert.deepEqual(serialization, ["list:1:start"]);
releaseFirstList();
await act(async () => Promise.all([firstRefresh, secondRefresh]));
assert.deepEqual(serialization, [
  "list:1:start",
  "list:1:end",
  "list:2:start",
  "list:2:end",
  "list:3:start",
  "list:3:end",
]);

assert.equal(Object.isFrozen(controller.getSnapshot()), true);
assert.equal(Object.isFrozen(controller.getSnapshot().recent), true);
assert.ok(container.querySelector("[data-custom-overlay]"));
assert.ok(findButton("选择 Workspace"));

await clickButton("选择 Workspace");
assert.ok(container.querySelector('[role="dialog"][aria-label="选择 Workspace"]'));
assert.ok(container.querySelector("[data-custom-overlay]"));
assert.match(container.textContent, /旧项目/);

await clickButton("选择 Workspace…");
assert.equal(calls.picks, 1);
assert.deepEqual(calls.opens, ["workspace-new"]);
assert.equal(shellStore.getSnapshot().workspace.label, "星海计划");
assert.equal(container.querySelector('[aria-label="选择 Workspace"]'), null);
await waitForReact(() =>
  container.textContent.includes("暂时无法加载对话，请重试新建对话"),
);

await clickButton("项目");
assert.ok(container.querySelector('[role="menu"][data-menu="project"]'));
await clickButton("关闭 Workspace");
assert.equal(calls.closes, 1);
assert.equal(shellStore.getSnapshot().workspace, undefined);
assert.ok(findButton("选择 Workspace"));

await clickButton("编辑");
assert.ok(container.querySelector('[role="menu"][data-menu="edit"]'));
await clickButton("设置…");
assert.ok(container.querySelector('[role="dialog"][aria-label="设置"]'));
assert.ok(container.querySelector("[data-custom-overlay]"));
assert.equal(container.textContent.includes("外观"), false);
assert.ok(container.querySelector('[aria-label="设置分类"]'));
assert.ok(container.querySelector('[aria-label="模型设置"]'));
assert.equal(container.querySelector("[data-extension-settings]"), null);

await clickButton("新增 Provider");
await setField("名称", "主力模型");
await setField("Provider ID", "openai");
await setField("模型 ID", "gpt-5");
await setField("Base URL", "https://api.example.test/v1");
await clickButton("保存 Provider");
const primaryProvider = settingsStore.getSnapshot().modelProviders[0];
assert.equal(primaryProvider.name, "主力模型");
assert.equal(settingsStore.getSnapshot().activeModelProviderId, primaryProvider.id);

await clickButton("新增 Provider");
await setField("名称", "备用模型");
await setField("Provider ID", "anthropic");
await selectField("API 协议", "anthropic-messages");
await setField("模型 ID", "claude-sonnet");
await clickButton("保存 Provider");
const secondaryProvider = settingsStore.getSnapshot().modelProviders[1];
await selectField("当前生效 Provider", secondaryProvider.id);
assert.equal(settingsStore.getSnapshot().activeModelProviderId, secondaryProvider.id);

const firstProviderRow = container.querySelectorAll(".novel-provider-row")[0];
const firstEditButton = [...firstProviderRow.querySelectorAll("button")].find(
  (button) => button.textContent.trim() === "编辑",
);
assert.ok(firstEditButton);
await act(async () => {
  firstEditButton.click();
});
await setField("模型 ID", "gpt-5.1");
await clickButton("保存 Provider");
assert.equal(settingsStore.getSnapshot().modelProviders[0].modelId, "gpt-5.1");

await clickButton("扩展");
assert.ok(container.querySelector("[data-extension-settings]"));

await clickButton("完成");
assert.equal(container.querySelector('[role="dialog"][aria-label="设置"]'), null);

await clickAriaButton("收起侧边栏");
assert.equal(settingsStore.getSnapshot().sidebarMode, "collapsed");
assert.equal(shellStore.getSnapshot().sidebarMode, "collapsed");
assert.equal(
  container.querySelector(".novel-shell-body").dataset.sidebarMode,
  "collapsed",
);
await clickAriaButton("展开侧边栏");
assert.equal(shellStore.getSnapshot().sidebarMode, "expanded");

await act(async () => root.unmount());
await transport.close();
await host.close();
console.log("workspace settings shell smoke passed");

function findButton(label) {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent.trim() === label,
  );
}

async function clickButton(label) {
  const button = findButton(label);
  assert.ok(button, `Button not found: ${label}`);
  await act(async () => button.click());
}

async function clickAriaButton(label) {
  const button = container.querySelector(`button[aria-label="${label}"]`);
  assert.ok(button, `Button not found: ${label}`);
  await act(async () => button.click());
}

async function setField(label, value) {
  const field = container.querySelector(`input[aria-label="${label}"]`);
  assert.ok(field, `Input not found: ${label}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(field, value);
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function selectField(label, value) {
  const field = container.querySelector(`select[aria-label="${label}"]`);
  assert.ok(field, `Select not found: ${label}`);
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

async function waitForReact(predicate, timeoutMs = 1_000) {
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

function createPlatform() {
  return Object.freeze({
    capabilities: Object.freeze({
      fileSelection: false,
      clipboardRead: false,
      clipboardWrite: false,
      notifications: false,
    }),
    files: Object.freeze({ selectFiles: async () => Object.freeze([]) }),
    clipboard: Object.freeze({
      readText: async () => "",
      writeText: async () => undefined,
    }),
    notifications: Object.freeze({ show: async () => undefined }),
  });
}
