import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { DefaultNovelApiClient } from "../../core/dist/index.js";
import {
  NodeConversationApiApplication,
  NodeWorkspaceStoreLocator,
} from "../../core/dist/node/index.js";
import { NovelApp, WorkspaceController } from "../dist/index.js";

installDom();
const rootDirectory = await mkdtemp(join(tmpdir(), "novel-ui-workspace-binding-"));
const workspaceRoot = join(rootDirectory, "创作项目");
await mkdir(workspaceRoot, { recursive: true });
const location = await new NodeWorkspaceStoreLocator({
  storageRoot: join(rootDirectory, "storage"),
}).resolve(workspaceRoot);
const application = await NodeConversationApiApplication.open({
  workspace: location,
  placement: {
    activate: async () => {
      throw new Error("Runtime is not used by this UI smoke");
    },
  },
});
const api = new DefaultNovelApiClient({ transport: application.transport });
const workspaceController = new WorkspaceController({
  picker: {
    pickWorkspace: async () => ({
      referenceId: location.workspaceId,
      label: "创作项目",
    }),
  },
  sessions: {
    listRecent: async () => Object.freeze([]),
    open: async () => ({ id: location.workspaceId, label: "创作项目" }),
    close: async () => undefined,
  },
});
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const reactRoot = createRoot(container);

await act(async () => {
  reactRoot.render(
    createElement(NovelApp, {
      api,
      platform: createPlatform(),
      workspaceController,
    }),
  );
});
await clickButton("选择 Workspace");
await clickButton("选择 Workspace…");
await waitForReact(() => container.querySelector(".novel-conversation-view") !== null);
await waitForReact(
  () => container.querySelector(".novel-conversation-view")?.dataset.controllerState === "live",
);
assert.match(container.textContent, /创作项目/);
assert.match(container.textContent, /Novel Agent/);
assert.equal(getConversationButtons().length, 1);
assert.equal(getConversationButtons()[0].dataset.active, "true");

const textarea = container.querySelector('textarea[aria-label="消息内容"]');
assert.ok(textarea);
await act(async () => {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  ).set;
  valueSetter.call(textarea, "让我们从一个雨夜开始故事");
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
});
await clickButton("发送");
await waitForReact(() =>
  container.textContent.includes("让我们从一个雨夜开始故事"),
);

await clickButton("新对话");
await waitForReact(() => getConversationButtons().length === 2);
assert.equal(getConversationButtons()[0].dataset.active, "true");
await act(async () => getConversationButtons()[1].click());
await waitForReact(() => getConversationButtons()[1].dataset.active === "true");

await act(async () => reactRoot.unmount());
await application.close();
console.log("conversation workspace binding smoke passed");

async function clickButton(label) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent.includes(label),
  );
  assert.ok(button, `missing button: ${label}`);
  await act(async () => button.click());
}

function getConversationButtons() {
  const sections = container.querySelectorAll(".novel-sidebar-section");
  return [...(sections[1]?.querySelectorAll("button") ?? [])];
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
