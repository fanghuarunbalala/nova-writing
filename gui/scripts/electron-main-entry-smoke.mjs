import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  API_PROTOCOL_VERSION,
  ApiTransportError,
} from "../../core/dist/index.js";
import {
  DesktopBootstrapApiTransport,
  resolveDesktopMainPaths,
} from "../dist/main/index.js";

const paths = resolveDesktopMainPaths(
  new URL("../dist/main/main.js", import.meta.url).href,
);
assert.match(paths.preloadPath, /dist[/\\]preload[/\\]preload\.cjs$/u);
assert.match(
  paths.rendererFilePath,
  /dist[/\\]renderer-app[/\\]index\.html$/u,
);

const transport = new DesktopBootstrapApiTransport();
const response = await transport.request({
  protocolVersion: API_PROTOCOL_VERSION,
  requestId: "desktop-bootstrap-request",
  operation: "conversation.list",
  payload: {},
});
assert.equal(response.ok, false);
assert.equal(response.requestId, "desktop-bootstrap-request");
assert.equal(response.error.code, "DESKTOP_WORKSPACE_NOT_OPEN");
assert.equal(response.error.category, "unavailable");
assert.equal(response.error.retryable, true);
assert.throws(
  () =>
    transport.subscribe({
      protocolVersion: API_PROTOCOL_VERSION,
      requestId: "desktop-bootstrap-subscription",
      operation: "conversation.events.subscribe",
      payload: {},
    }),
  (error) =>
    error instanceof ApiTransportError &&
    error.code === "DESKTOP_WORKSPACE_NOT_OPEN" &&
    error.retryable,
);

const source = await readFile(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);
assert.match(source, /rendererTarget: \{ kind: "file"/u);
const windowManagerSource = await readFile(
  new URL("../src/main/DesktopWindowManager.ts", import.meta.url),
  "utf8",
);
assert.match(windowManagerSource, /contextIsolation:\s*true/u);
assert.match(windowManagerSource, /sandbox:\s*true/u);
assert.match(windowManagerSource, /nodeIntegration:\s*false/u);

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
assert.equal(packageJson.main, "dist/renderer/index.js");
assert.equal(packageJson.scripts.start, "electron dist/main/main.js");
assert.equal(packageJson.scripts["start:build"], "pnpm build && pnpm start");

console.log("electron main entry smoke passed");
