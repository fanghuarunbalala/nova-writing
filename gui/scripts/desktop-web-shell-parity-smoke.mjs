import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { act } from "react";
import { register } from "node:module";

// CSS 由 Vite 消费；Node 侧先注册 stub loader 再动态加载 renderer dist。
register(new URL("./node-css-loader.mjs", import.meta.url));
const { mountDesktopRenderer } = await import("../dist/renderer/index.js");
const { mountWebBrowser } = await import("../../web/dist/browser/index.js");

async function run() {
  await assertResponsiveShellStyles();
  const dom = installDom();
  const bridge = new TestElectronBridge();
  let desktop;
  let web;
  await act(async () => {
    desktop = mountDesktopRenderer({
      window: { novelDesktop: bridge },
      document: dom.window.document,
      rootElementId: "desktop-root",
      appProps: {},
    });
    web = mountWebBrowser({
      window: dom.window,
      document: dom.window.document,
      rootElementId: "web-root",
      appProps: {},
    });
  });

  const desktopRoot = requireElement(dom.window.document, "desktop-root");
  const webRoot = requireElement(dom.window.document, "web-root");
  assertDesktopFallback(desktopRoot);
  assertWebFallback(webRoot);
  assert.deepEqual(desktop.platform.capabilities, web.platform.capabilities);
  assert.equal(bridge.callCount, 0);

  await act(async () => {
    await Promise.all([desktop.close(), web.close()]);
  });
  assert.equal(desktopRoot.childNodes.length, 0);
  assert.equal(webRoot.childNodes.length, 0);

  console.log("desktop / web shared NovelApp parity smoke passed");
}

function assertDesktopFallback(desktopRoot) {
  // 未注入 WorkspaceController 时，新壳显示等待态（mount/close 契约成立）
  assert.match(desktopRoot.textContent, /等待 Workspace 控制器/);
}

function assertWebFallback(webRoot) {
  assert.match(webRoot.textContent, /等待 Workspace 控制器/);
}

async function assertResponsiveShellStyles() {
  const [desktopCss] = await Promise.all([
    readFile(new URL("../src/renderer/renderer.css", import.meta.url), "utf8"),
  ]);
  assert.match(desktopCss, /min-width:\s*0/);
  assert.equal(/min-width:\s*760px/.test(desktopCss), false);
}

class TestElectronBridge {
  constructor() {
    Object.defineProperty(this, "callCount", {
      value: 0,
      writable: true,
      enumerable: false,
    });
    for (const method of [
      "request",
      "cancelRequest",
      "openSubscription",
      "readSubscription",
      "closeSubscription",
    ]) {
      this[method] = this[method].bind(this);
    }
  }

  async request(request) {
    this.callCount += 1;
    return {
      ok: true,
      value: {
        protocolVersion: request.protocolVersion,
        requestId: request.requestId,
        ok: true,
        data: null,
      },
    };
  }

  async cancelRequest() {
    this.callCount += 1;
    return acknowledgement();
  }

  async openSubscription() {
    this.callCount += 1;
    return acknowledgement();
  }

  async readSubscription() {
    this.callCount += 1;
    return { ok: true, value: { done: true } };
  }

  async closeSubscription() {
    this.callCount += 1;
    return acknowledgement();
  }
}

function captureShell(root) {
  return {
    menu: textList(root, ".novel-menu-button"),
    contextLabels: textList(root, ".novel-context-label"),
    contextValues: textList(root, ".novel-context-value"),
    navigation: textList(root, ".novel-sidebar-section:first-child .novel-sidebar-label"),
    conversations: textList(root, ".novel-sidebar-section:last-child .novel-sidebar-label"),
    sidebarMode: root
      .querySelector(".novel-shell-body")
      ?.getAttribute("data-sidebar-mode"),
    inspectorMode: root
      .querySelector(".novel-shell-body")
      ?.getAttribute("data-inspector-mode"),
    inspectorTitle: root.querySelector(".novel-inspector-panel h2")?.textContent ?? null,
    inspectorState:
      root.querySelector(".novel-inspector-panel")?.getAttribute("data-content-state") ?? null,
  };
}

function textList(root, selector) {
  return [...root.querySelectorAll(selector)].map((element) =>
    element.textContent.trim(),
  );
}

function findButton(root, label) {
  const labelElement = [...root.querySelectorAll(".novel-sidebar-label")].find(
    (candidate) => candidate.textContent.trim() === label,
  );
  const button = labelElement?.closest("button");
  assert.ok(button, `missing button: ${label}`);
  return button;
}

function requireElement(document, id) {
  const element = document.getElementById(id);
  assert.ok(element, `missing root: ${id}`);
  return element;
}

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='desktop-root'></div><div id='web-root'></div></body></html>",
    { pretendToBeVisual: true, url: "https://novel.example/project/demo" },
  );
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
  return dom;
}

function acknowledgement() {
  return { ok: true, value: { acknowledged: true } };
}

await run();
