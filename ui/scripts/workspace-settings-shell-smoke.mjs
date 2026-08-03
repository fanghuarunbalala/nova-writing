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
assert.match(container.textContent, /选择或新建一个对话/);

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
assert.ok(container.querySelector("[data-extension-settings]"));
const sidebarSelect = container.querySelector('select[aria-label="项目侧栏"]');
assert.ok(sidebarSelect);
await act(async () => {
  sidebarSelect.value = "collapsed";
  sidebarSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
});
assert.equal(settingsStore.getSnapshot().sidebarMode, "collapsed");
assert.equal(shellStore.getSnapshot().sidebarMode, "collapsed");
assert.equal(
  container.querySelector(".novel-shell-body").dataset.sidebarMode,
  "collapsed",
);

await clickButton("完成");
assert.equal(container.querySelector('[role="dialog"][aria-label="设置"]'), null);

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
