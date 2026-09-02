import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ApiTransportError,
} from "../../core/dist/index.js";
import {
  DesktopApplication,
  DesktopWindowManager,
  createDesktopApplicationMenuTemplate,
  createSecureWindowOptions,
} from "../dist/main/index.js";
import { createElectronPreloadBridge } from "../dist/preload/index.js";
import {
  ELECTRON_API_IPC_CHANNELS,
  ELECTRON_APPLICATION_COMMAND_CHANNEL,
} from "../dist/shared/index.js";

async function runDesktopShellSmoke() {
  const logs = [];
  const app = new FakeElectronApp();
  const ipcMain = new FakeIpcMain();
  const host = new TestHostTransport();
  const windows = [];
  const application = new DesktopApplication({
    app,
    ipcMain,
    transport: host,
    createWindow: (options) => {
      const window = new FakeBrowserWindow(100 + windows.length, options);
      windows.push(window);
      return window;
    },
    preloadPath: "/private/application/preload.cjs",
    rendererTarget: { kind: "url", url: "http://127.0.0.1:5173" },
    platform: "linux",
    logger: createCollectingLogger(logs),
  });

  await application.start();
  assert.equal(windows.length, 1);
  assert.equal(windows[0].loadedUrl, "http://127.0.0.1:5173");
  assertSecureWindowOptions(windows[0].options);
  assert.equal(application.windowManager.ownsSender(100), true);
  assert.deepEqual(new Set(ipcMain.handlers.keys()), new Set(ELECTRON_API_IPC_CHANNELS));
  assert.equal(application.dispatchCommand("settings.open"), true);
  assert.deepEqual(windows[0].webContents.sent, [
    {
      channel: ELECTRON_APPLICATION_COMMAND_CHANNEL,
      value: "settings.open",
    },
  ]);
  assertNativeMenuTemplate();

  windows[0].emit("ready-to-show");
  assert.equal(windows[0].shown, true);
  assert.deepEqual(windows[0].webContents.openWindow(), { action: "deny" });
  assert.equal(windows[0].webContents.navigate("https://untrusted.example"), true);
  assert.equal(windows[0].webContents.attachWebview(), true);
  assert.equal(windows[0].webContents.requestPermission("camera"), false);

  const bridge = createElectronPreloadBridge({
    ipcRenderer: new FakeIpcRenderer(ipcMain, 100),
  });
  const response = await bridge.request(createRequest("request-authorized"));
  assert.equal(response.ok, true);
  const subscriptionId = "electron:subscription-owned";
  assert.equal(
    (await bridge.openSubscription({
      subscriptionId,
      request: createRequest("subscription-owned", "test.subscribe"),
    })).ok,
    true,
  );

  windows[0].close();
  assert.equal(application.dispatchCommand("workspace.open"), false);
  await waitFor(() => host.closedSubscriptionIds.includes("host:subscription-owned"));
  assert.equal(application.windowManager.ownsSender(100), false);

  app.emit("activate");
  await waitFor(() => windows.length === 2);
  assert.equal(application.windowManager.ownsSender(101), true);
  app.emit("window-all-closed");
  assert.equal(app.quitCount, 1);

  await application.stop();
  await application.stop();
  assert.equal(ipcMain.handlers.size, 0);
  assert.equal(windows[1].closed, true);
  assert.equal(JSON.stringify(logs).includes("/private/application"), false);

  await assertLoadFailureRedaction();
  await assertElectronEntrypointSources();
}

function assertNativeMenuTemplate() {
  const commands = [];
  const newWindows = [];
  const template = createDesktopApplicationMenuTemplate({
    applicationName: "Novel",
    platform: "darwin",
    dispatch: (command) => commands.push(command),
    openNewWindow: () => newWindows.push(true),
  });
  assert.deepEqual(
    template.map((item) => item.label),
    ["Novel", "项目", "设置", "帮助"],
  );
  const projectMenu = template[1].submenu;
  projectMenu[0].click();
  projectMenu[1].click();
  const settingsMenu = template[2].submenu;
  settingsMenu[0].click();
  assert.deepEqual(commands, ["workspace.open", "settings.open"]);
  assert.deepEqual(newWindows, [true]);
}

function assertSecureWindowOptions(options) {
  assert.equal(options.show, false);
  assert.equal(options.backgroundColor, "#F7F8FA");
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.nodeIntegrationInWorker, false);
  assert.equal(options.webPreferences.webviewTag, false);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(options.webPreferences.allowRunningInsecureContent, false);
  assert.equal(options.webPreferences.safeDialogs, true);
  assert.equal(options.webPreferences.preload, "/private/application/preload.cjs");
}

async function assertLoadFailureRedaction() {
  const failureLogs = [];
  const window = new FakeBrowserWindow(201, createSecureWindowOptions("/preload.cjs"));
  window.loadURL = async () => {
    throw new Error("private renderer load failure");
  };
  const manager = new DesktopWindowManager({
    preloadPath: "/preload.cjs",
    rendererTarget: { kind: "url", url: "https://private-renderer.example" },
    createWindow: () => window,
    releaseSender: async () => undefined,
    logger: createCollectingLogger(failureLogs),
  });
  await assert.rejects(
    manager.openPrimaryWindow(),
    (error) =>
      error instanceof ApiTransportError &&
      error.code === "ELECTRON_WINDOW_LOAD_FAILED" &&
      !error.message.includes("private renderer load failure"),
  );
  assert.equal(window.closed, true);
  assert.equal(JSON.stringify(failureLogs).includes("private-renderer"), false);
}

async function assertElectronEntrypointSources() {
  const mainSource = await readFile(
    new URL("../src/main/createElectronDesktopApplication.ts", import.meta.url),
    "utf8",
  );
  const preloadSource = await readFile(
    new URL("../src/preload/preload.ts", import.meta.url),
    "utf8",
  );
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.match(mainSource, /import \{ app, BrowserWindow, ipcMain \} from "electron"/);
  assert.match(preloadSource, /import \{ contextBridge, ipcRenderer \} from "electron"/);
  assert.match(preloadSource, /exposeDesktopApi\(\{ contextBridge, ipcRenderer \}\)/);
  const preloadBundle = await readFile(
    new URL("../dist/preload/preload.cjs", import.meta.url),
    "utf8",
  );
  assert.match(preloadBundle, /require\(["']electron["']\)/);
  assert.equal(/^\s*import\s/m.test(preloadBundle), false);
  assert.equal(packageJson.devDependencies.electron, "43.2.0");
  assert.equal(packageJson.devDependencies.esbuild, "0.28.1");
}

class FakeElectronApp {
  listeners = new Map();
  quitCount = 0;

  async whenReady() {}

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event, listener) {
    this.listeners.get(event)?.delete(listener);
  }

  quit() {
    this.quitCount += 1;
  }

  emit(event) {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}

class FakeIpcMain {
  handlers = new Map();

  handle(channel, handler) {
    this.handlers.set(channel, handler);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }

  async invoke(senderId, channel, ...args) {
    const handler = this.handlers.get(channel);
    if (handler === undefined) throw new Error("missing handler");
    return handler({ sender: { id: senderId } }, ...args);
  }
}

class FakeIpcRenderer {
  constructor(ipcMain, senderId) {
    this.ipcMain = ipcMain;
    this.senderId = senderId;
  }

  invoke(channel, ...args) {
    return this.ipcMain.invoke(this.senderId, channel, ...args);
  }
}

class FakeBrowserWindow {
  listeners = new Map();
  shown = false;
  closed = false;
  loadedUrl;
  loadedFile;

  constructor(senderId, options) {
    this.options = options;
    this.webContents = new FakeWebContents(senderId);
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  emit(event) {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  async loadURL(url) {
    this.loadedUrl = url;
  }

  async loadFile(filePath) {
    this.loadedFile = filePath;
  }

  show() {
    this.shown = true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.webContents.emit("destroyed");
    this.emit("closed");
  }

  isDestroyed() {
    return this.closed;
  }
}

class FakeWebContents {
  listeners = new Map();
  sent = [];
  windowOpenHandler;
  permissionHandler;

  constructor(id) {
    this.id = id;
    this.session = {
      setPermissionRequestHandler: (handler) => {
        this.permissionHandler = handler;
      },
    };
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  send(channel, value) {
    this.sent.push({ channel, value });
  }

  emit(event, ...args) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }

  openWindow() {
    return this.windowOpenHandler();
  }

  navigate(url) {
    let prevented = false;
    this.emit("will-navigate", { preventDefault: () => (prevented = true) }, url);
    return prevented;
  }

  attachWebview() {
    let prevented = false;
    this.emit("will-attach-webview", { preventDefault: () => (prevented = true) });
    return prevented;
  }

  requestPermission(permission) {
    let allowed;
    this.permissionHandler(this, permission, (value) => (allowed = value));
    return allowed;
  }
}

class TestHostTransport {
  closedSubscriptionIds = [];

  async request(request) {
    return {
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      data: { accepted: true },
    };
  }

  subscribe(request) {
    const id = `host:${request.requestId}`;
    let closed = false;
    return {
      id,
      next: async () => ({ done: true, value: undefined }),
      return: async () => ({ done: true, value: undefined }),
      [Symbol.asyncIterator]() {
        return this;
      },
      close: async () => {
        if (closed) return;
        closed = true;
        this.closedSubscriptionIds.push(id);
      },
    };
  }
}

function createRequest(requestId, operation = "test.request") {
  return { protocolVersion: 1, requestId, operation, payload: null };
}

function createCollectingLogger(entries) {
  return {
    debug: (event, fields) => entries.push({ level: "debug", event, fields }),
    info: (event, fields) => entries.push({ level: "info", event, fields }),
    warn: (event, fields) => entries.push({ level: "warn", event, fields }),
    error: (event, fields) => entries.push({ level: "error", event, fields }),
    child() {
      return this;
    },
  };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for desktop state");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

await runDesktopShellSmoke();
console.log("electron desktop shell smoke passed");
