import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noopLogger } from "../../core/dist/index.js";
import { NodeWorkspaceStoreLocator } from "../../core/dist/node/index.js";
import {
  DesktopWorkspaceIpcController,
  DesktopWorkspaceService,
} from "../dist/main/index.js";
import { createElectronPreloadBridge } from "../dist/preload/index.js";
import { createElectronWorkspaceController } from "../dist/renderer/index.js";
import { ELECTRON_WORKSPACE_IPC_CHANNELS } from "../dist/shared/index.js";

async function run() {
  const root = await mkdtemp(join(tmpdir(), "novel-electron-workspace-"));
  const workspaceRoot = join(root, "星海计划");
  await mkdir(workspaceRoot, { recursive: true });
  const picks = [workspaceRoot, workspaceRoot];
  const service = new DesktopWorkspaceService({
    picker: { pickDirectory: async () => picks.shift() },
    locator: new NodeWorkspaceStoreLocator({ storageRoot: join(root, "storage") }),
  });
  const ipcMain = new FakeIpcMain();
  const controller = new DesktopWorkspaceIpcController({
    service,
    authorizeSender: (senderId) => senderId === 1 || senderId === 2,
  });
  controller.register(ipcMain);
  assert.deepEqual(
    new Set(ipcMain.handlers.keys()),
    new Set(ELECTRON_WORKSPACE_IPC_CHANNELS),
  );

  const ownerBridge = createElectronPreloadBridge({
    ipcRenderer: new FakeIpcRenderer(ipcMain, 1),
  });
  const ownerController = createElectronWorkspaceController(ownerBridge, noopLogger);
  assert.ok(ownerController);
  await ownerController.refresh();
  assert.deepEqual(ownerController.getSnapshot().recent, []);
  const opened = await ownerController.chooseAndOpen();
  assert.ok(opened);
  assert.match(opened.id, /^ws-/u);
  assert.equal(opened.label, "星海计划");
  assert.equal(ownerController.getSnapshot().phase, "ready");
  assert.equal(ownerController.getSnapshot().current.id, opened.id);
  assert.equal(
    JSON.stringify(ownerController.getSnapshot()).includes(workspaceRoot),
    false,
  );

  await ownerController.refresh();
  assert.deepEqual(ownerController.getSnapshot().recent, [opened]);
  assert.equal(await ownerController.closeCurrent(), true);
  assert.equal(ownerController.getSnapshot().current, undefined);

  const selection = await ownerBridge.workspaces.select();
  assert.equal(selection.ok, true);
  assert.ok(selection.value);
  assert.equal(selection.value.referenceId.includes(workspaceRoot), false);
  const otherBridge = createElectronPreloadBridge({
    ipcRenderer: new FakeIpcRenderer(ipcMain, 2),
  });
  const unauthorized = await otherBridge.workspaces.open(selection.value);
  assert.deepEqual(unauthorized, {
    ok: false,
    error: { code: "DESKTOP_WORKSPACE_UNAUTHORIZED", retryable: false },
  });

  const index = JSON.parse(
    await readFile(join(root, "storage", "workspace-index.json"), "utf8"),
  );
  assert.equal(index.workspaces.length, 1);
  assert.equal(index.workspaces[0].workspaceId, opened.id);

  await controller.releaseSender(1);
  await controller.dispose();
  assert.equal(ipcMain.handlers.size, 0);
  console.log("electron workspace selection smoke passed");
}

class FakeIpcMain {
  handlers = new Map();

  handle(channel, handler) {
    if (this.handlers.has(channel)) throw new Error("duplicate channel");
    this.handlers.set(channel, handler);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }

  async invoke(senderId, channel, ...args) {
    const handler = this.handlers.get(channel);
    if (handler === undefined) throw new Error("missing handler");
    return jsonRoundTrip(await handler({ sender: { id: senderId } }, ...args));
  }
}

class FakeIpcRenderer {
  constructor(ipcMain, senderId) {
    this.ipcMain = ipcMain;
    this.senderId = senderId;
  }

  invoke(channel, ...args) {
    return this.ipcMain.invoke(this.senderId, channel, ...jsonRoundTrip(args));
  }
}

function jsonRoundTrip(value) {
  return JSON.parse(JSON.stringify(value));
}

await run();
