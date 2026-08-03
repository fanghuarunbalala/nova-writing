import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { act } from "react";
import {
  ApiTransportError,
  DefaultNovelApiClient,
} from "../../core/dist/index.js";
import {
  createBrowserFrontendPlatform,
  createWebBrowserComposition,
  mountWebBrowser,
  resolveWebApiOrigin,
} from "../dist/browser/index.js";

await assertBrowserOrigin();
await assertBrowserComposition();
await assertBrowserMount();
await assertBrowserBuildArtifacts();

console.log("web browser bootstrap smoke passed");

async function assertBrowserOrigin() {
  assert.equal(
    resolveWebApiOrigin({ origin: "https://novel.example" }),
    "https://novel.example",
  );
  assert.equal(
    resolveWebApiOrigin({ origin: "http://127.0.0.1:4173" }),
    "http://127.0.0.1:4173",
  );
  for (const origin of ["null", "file://", "https://novel.example/path", "javascript:"]) {
    assert.throws(
      () => resolveWebApiOrigin({ origin }),
      (error) =>
        error instanceof ApiTransportError &&
        error.code === "WEB_BROWSER_ORIGIN_INVALID",
    );
  }
}

async function assertBrowserComposition() {
  const platform = createBrowserFrontendPlatform();
  const requests = [];
  const composition = createWebBrowserComposition({
    window: { location: { origin: "https://novel.example" } },
    platform,
    transport: {
      fetch: async (input, init) => {
        requests.push({ input: String(input), init });
        const request = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            protocolVersion: request.protocolVersion,
            requestId: request.requestId,
            ok: true,
            data: { acknowledged: true },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  });

  assert.ok(composition.api instanceof DefaultNovelApiClient);
  assert.equal(composition.origin, "https://novel.example");
  assert.equal(composition.platform, platform);
  assert.equal(Object.isFrozen(platform), true);
  assert.deepEqual(platform.capabilities, {
    fileSelection: false,
    clipboardRead: false,
    clipboardWrite: false,
    notifications: false,
  });
  assert.deepEqual(await platform.files.selectFiles(), []);
  await composition.transport.request(createRequest("same-origin-request"));
  assert.equal(requests[0].input, "https://novel.example/api/v1/requests");
  assert.equal(requests[0].init.credentials, "include");
  await composition.transport.close();
}

async function assertBrowserMount() {
  const dom = installDom();
  let mounted;
  await act(async () => {
    mounted = mountWebBrowser({
      window: dom.window,
      document: dom.window.document,
    });
  });
  assert.ok(dom.window.document.querySelector(".novel-app-shell"));
  assert.ok(dom.window.document.querySelector(".novel-project-sidebar"));
  assert.match(dom.window.document.body.textContent, /新对话/);
  assert.match(dom.window.document.body.textContent, /大纲/);
  assert.equal(mounted.origin, "https://novel.example");
  await act(async () => mounted.close());
  assert.equal(dom.window.document.getElementById("root").childNodes.length, 0);

  assert.throws(
    () =>
      mountWebBrowser({
        window: dom.window,
        document: { getElementById: () => null },
      }),
    (error) =>
      error instanceof ApiTransportError &&
      error.code === "WEB_BROWSER_ROOT_MISSING",
  );
}

async function assertBrowserBuildArtifacts() {
  const html = await readFile(
    new URL("../dist/browser-app/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /connect-src 'self' ws: wss:/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.equal(html.includes('src="/assets/'), false);
  assert.equal(html.includes('href="/assets/'), false);

  const assets = await readdir(
    new URL("../dist/browser-app/assets/", import.meta.url),
  );
  assert.equal(assets.some((name) => name.endsWith(".js")), true);
  assert.equal(assets.some((name) => name.endsWith(".css")), true);

  const browserSources = await Promise.all(
    [
      "../src/browser/BrowserFrontendPlatform.ts",
      "../src/browser/WebBrowserBootstrap.tsx",
      "../src/browser/main.tsx",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  const source = browserSources.join("\n");
  for (const pattern of [
    /from\s+["']electron["']/,
    /from\s+["']node:/,
    /\bipcRenderer\b/,
    /\bprocess\s*\./,
    /from\s+["'](?:node:)?fs/,
  ]) {
    assert.equal(pattern.test(source), false, `forbidden browser source: ${pattern}`);
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

function createRequest(requestId) {
  return {
    protocolVersion: 1,
    requestId,
    operation: "test.request",
    payload: null,
  };
}
