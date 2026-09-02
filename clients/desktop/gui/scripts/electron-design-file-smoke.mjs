/**
 * electron-design-file-smoke
 *
 * compose 设计草稿文件端口验证：
 * 1. IPC channel 对象 frozen + 命名规范（novel.design.v1.*）
 * 2. DesktopDesignIpcController.register() 绑定 read/write 通道
 * 3. 未授权 sender 返回 { ok: false, error: { code: "unauthorized" } }
 * 4. 授权 sender：read 读取 design 文件、write 创建/覆盖 design 文件
 * 5. dispose() 移除所有 handler
 * 6. renderer port unwrap()：{ ok: false } 抛 ApiTransportError
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ApiTransportError } from "../../core/dist/index.js";
import {
  DesktopDesignFileService,
  DesktopDesignIpcController,
} from "../dist/main/desktop/design/index.js";
import {
  ELECTRON_DESIGN_IPC_CHANNEL,
  ELECTRON_DESIGN_IPC_CHANNELS,
} from "../dist/shared/index.js";
import { createElectronDesignFilePort } from "../dist/renderer/platform/index.js";

// --- channel frozen + 命名规范 ---
assert.equal(Object.isFrozen(ELECTRON_DESIGN_IPC_CHANNEL), true);
assert.equal(ELECTRON_DESIGN_IPC_CHANNELS.length, 2);
for (const channel of Object.values(ELECTRON_DESIGN_IPC_CHANNEL)) {
  assert.match(channel, /^novel\.design\.v1\./);
}

// --- 临时 workspace + design 文件 ---
const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-port-smoke-"));
const workspaceRoot = path.join(root, "workspace");
const designDir = path.join(workspaceRoot, ".novel", "design");
await fs.mkdir(designDir, { recursive: true });
await fs.writeFile(
  path.join(designDir, "conversation-e2e.md"),
  "第三章正文草稿\n",
  "utf8",
);

const service = new DesktopDesignFileService({
  resolveWorkspaceRoot: (senderId) =>
    senderId === 7 ? workspaceRoot : undefined,
});

class FakeIpcMain {
  handlers = new Map();
  handle(channel, handler) {
    if (this.handlers.has(channel)) throw new Error(`duplicate: ${channel}`);
    this.handlers.set(channel, handler);
  }
  removeHandler(channel) {
    this.handlers.delete(channel);
  }
}

const authorizeSender = (senderId) => senderId === 7;
const ipcMain = new FakeIpcMain();
const controller = new DesktopDesignIpcController({
  service,
  authorizeSender,
});
controller.register(ipcMain);

assert.equal(ipcMain.handlers.has(ELECTRON_DESIGN_IPC_CHANNEL.read), true);
assert.equal(ipcMain.handlers.has(ELECTRON_DESIGN_IPC_CHANNEL.write), true);

const sender = { sender: { id: 7 } };
const stranger = { sender: { id: 99 } };

// 未授权
const unauthorized = await ipcMain.handlers.get(ELECTRON_DESIGN_IPC_CHANNEL.read)(
  stranger,
  "conversation:e2e",
);
assert.equal(unauthorized.ok, false);
assert.equal(unauthorized.error.code, "unauthorized");

// 授权 read
const read = await ipcMain.handlers.get(ELECTRON_DESIGN_IPC_CHANNEL.read)(
  sender,
  "conversation:e2e",
);
assert.equal(read.ok, true);
assert.equal(read.value.content, "第三章正文草稿\n");

// 授权 write（新建文件）
const write = await ipcMain.handlers.get(ELECTRON_DESIGN_IPC_CHANNEL.write)(
  sender,
  "conversation:new",
  "新草稿\n",
);
assert.equal(write.ok, true);
assert.equal(
  await fs.readFile(
    path.join(designDir, "conversation-new.md"),
    "utf8",
  ),
  "新草稿\n",
);

// read 不存在的文件
const missing = await ipcMain.handlers.get(ELECTRON_DESIGN_IPC_CHANNEL.read)(
  sender,
  "conversation:missing",
);
assert.equal(missing.ok, false);
assert.equal(missing.error.code, "design_file_not_found");

// dispose 移除 handler
await controller.dispose();
assert.equal(ipcMain.handlers.has(ELECTRON_DESIGN_IPC_CHANNEL.read), false);
assert.equal(ipcMain.handlers.has(ELECTRON_DESIGN_IPC_CHANNEL.write), false);

// renderer port unwrap
const designPort = createElectronDesignFilePort({
  design: {
    read: async () => ({
      ok: false,
      error: { code: "design_file_not_found", retryable: false },
    }),
    write: async () => ({ ok: true, value: { acknowledged: true } }),
  },
});
assert.ok(designPort);
await assert.rejects(
  () => designPort.read("conversation:missing"),
  ApiTransportError,
);
await designPort.write("conversation:x", "content");

await fs.rm(root, { recursive: true, force: true });
console.log("electron design file smoke passed");
