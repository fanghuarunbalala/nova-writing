import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { act } from "react";
import {
  ApiTransportError,
  DefaultNovelApiClient,
} from "../../core/dist/index.js";
import {
  createDesktopRendererComposition,
  createElectronFrontendPlatform,
  mountDesktopRenderer,
  resolveElectronPreloadBridge,
} from "../dist/renderer/index.js";

class TestElectronBridge {
  constructor() {
    Object.defineProperty(this, "commandListeners", {
      value: new Set(),
      enumerable: false,
    });
    this.commands = Object.freeze({
      subscribe: (listener) => {
        this.commandListeners.add(listener);
        return () => this.commandListeners.delete(listener);
      },
    });
    Object.defineProperty(this, "requests", {
      value: [],
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
    this.requests.push(request);
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
    return acknowledgement();
  }

  async openSubscription() {
    return acknowledgement();
  }

  async readSubscription() {
    return { ok: true, value: { done: true } };
  }

  async closeSubscription() {
    return acknowledgement();
  }

  emitCommand(command) {
    for (const listener of [...this.commandListeners]) listener(command);
  }
}

await assertBridgeGuard();
await assertRendererComposition();
await assertRendererMount();
await assertRendererBuildArtifacts();

console.log("electron renderer bootstrap smoke passed");

async function assertBridgeGuard() {
  const bridge = new TestElectronBridge();
  const resolved = resolveElectronPreloadBridge({ novelDesktop: bridge });
  assert.equal(Object.isFrozen(resolved), true);
  assert.notEqual(resolved, bridge);
  assert.deepEqual(Object.keys(resolved).sort(), [
    "cancelRequest",
    "closeSubscription",
    "commands",
    "openSubscription",
    "readSubscription",
    "request",
  ]);
  await resolved.request(createRequest("guard-request"));
  assert.equal(bridge.requests.length, 1);

  for (const value of [undefined, null, {}, { ...bridge, unrestricted: () => {} }]) {
    assert.throws(
      () => resolveElectronPreloadBridge({ novelDesktop: value }),
      (error) =>
        error instanceof ApiTransportError &&
        error.code === "ELECTRON_PRELOAD_BRIDGE_UNAVAILABLE",
    );
  }
}

async function assertRendererComposition() {
  const bridge = new TestElectronBridge();
  const platform = createElectronFrontendPlatform();
  const composition = createDesktopRendererComposition({
    window: { novelDesktop: bridge },
    platform,
  });

  assert.ok(composition.api instanceof DefaultNovelApiClient);
  assert.ok(composition.commandSource);
  assert.equal(composition.platform, platform);
  assert.equal(Object.isFrozen(platform), true);
  assert.deepEqual(platform.capabilities, {
    fileSelection: false,
    clipboardRead: false,
    clipboardWrite: false,
    notifications: false,
  });
  assert.deepEqual(await platform.files.selectFiles(), []);
  await composition.transport.close();
}

async function assertRendererMount() {
  const dom = installDom();
  const bridge = new TestElectronBridge();
  let mounted;
  await act(async () => {
    mounted = mountDesktopRenderer({
      window: { novelDesktop: bridge },
      document: dom.window.document,
    });
  });
  assert.ok(dom.window.document.querySelector(".novel-app-shell"));
  assert.equal(dom.window.document.querySelector(".novel-top-menu"), null);
  assert.equal(
    dom.window.document
      .querySelector(".novel-app-shell")
      ?.getAttribute("data-menu-presentation"),
    "native",
  );
  assert.ok(dom.window.document.querySelector('button[aria-label="收起侧边栏"]'));
  assert.ok(dom.window.document.querySelector(".novel-project-sidebar"));
  assert.match(dom.window.document.body.textContent, /新对话/);
  assert.match(dom.window.document.body.textContent, /大纲/);
  await act(async () => bridge.emitCommand("settings.open"));
  assert.ok(dom.window.document.querySelector('[role="dialog"][aria-label="设置"]'));
  await act(async () => mounted.close());
  assert.equal(bridge.commandListeners.size, 0);
  assert.equal(dom.window.document.getElementById("root").childNodes.length, 0);

  assert.throws(
    () =>
      mountDesktopRenderer({
        window: { novelDesktop: new TestElectronBridge() },
        document: { getElementById: () => null },
      }),
    (error) =>
      error instanceof ApiTransportError &&
      error.code === "ELECTRON_RENDERER_ROOT_MISSING",
  );
}

async function assertRendererBuildArtifacts() {
  const html = await readFile(
    new URL("../dist/renderer-app/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.equal(html.includes('src="/assets/'), false);
  assert.equal(html.includes('href="/assets/'), false);

  const assetsDirectory = new URL(
    "../dist/renderer-app/assets/",
    import.meta.url,
  );
  const assets = await readdir(assetsDirectory);
  assert.equal(assets.some((name) => name.endsWith(".js")), true);
  assert.equal(assets.some((name) => name.endsWith(".css")), true);

  const rendererSources = await Promise.all(
    [
      "../src/renderer/DesktopRendererBootstrap.tsx",
      "../src/renderer/ElectronPreloadBridgeResolver.ts",
      "../src/renderer/ElectronFrontendPlatform.ts",
      "../src/renderer/main.tsx",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  const source = rendererSources.join("\n");
  for (const pattern of [
    /from\s+["']electron["']/,
    /from\s+["']node:/,
    /\bipcRenderer\b/,
    /\bprocess\s*\./,
    /from\s+["'](?:node:)?fs/,
  ]) {
    assert.equal(pattern.test(source), false, `forbidden Renderer source: ${pattern}`);
  }

  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageJson.dependencies["react-dom"], "19.2.8");
  assert.equal(packageJson.devDependencies.vite, "8.2.0");
  assert.equal(packageJson.devDependencies["@vitejs/plugin-react"], "6.0.5");
}

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { pretendToBeVisual: true },
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

function createRequest(requestId) {
  return {
    protocolVersion: 1,
    requestId,
    operation: "test.request",
    payload: null,
  };
}

function acknowledgement() {
  return { ok: true, value: { acknowledged: true } };
}
