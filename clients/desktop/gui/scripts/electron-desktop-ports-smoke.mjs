/**
 * electron-desktop-ports-smoke
 *
 * 4 个桌面 platform port 全栈运行时验证（spec 5.4）。
 *
 * 验证矩阵：
 * 1. IPC channel 对象 frozen + 命名规范（novel.{domain}.v1.*）
 * 2. 每个 controller.register() 绑定预期通道到 ipcMain.handle
 * 3. 未授权 sender 返回 { ok: false, error: { code: "ELECTRON_IPC_UNAUTHORIZED" } }
 * 4. 授权 sender 返回 { ok: true, value } 包装 service 结果
 * 5. controller.dispose() 移除所有 handler
 * 6. service 抛错时 controller 包装为 { ok: false, error: { code, retryable } }
 * 7. renderer port unwrap() 在 { ok: false } 时抛 ApiTransportError，{ ok: true } 返回 value
 * 8. bridge 子 API 缺失时 createDesktopPlatformApi 对应 port 为 undefined
 */
import assert from "node:assert/strict";
import { ApiTransportError } from "../../core/dist/index.js";
import {
  DesktopNativeFileIpcController,
  DesktopNativeFileService,
} from "../dist/main/desktop/nativefile/index.js";
import {
  DesktopSystemTrayIpcController,
  DesktopSystemTrayService,
} from "../dist/main/desktop/tray/index.js";
import {
  DesktopUpdaterIpcController,
  DesktopUpdaterService,
} from "../dist/main/desktop/updater/index.js";
import {
  DesktopWindowIpcController,
  DesktopWindowService,
} from "../dist/main/desktop/window/index.js";
import {
  ELECTRON_NATIVE_FILE_IPC_CHANNEL,
  ELECTRON_NATIVE_FILE_IPC_CHANNELS,
  ELECTRON_SYSTEM_TRAY_IPC_CHANNEL,
  ELECTRON_SYSTEM_TRAY_IPC_CHANNELS,
  ELECTRON_UPDATER_IPC_CHANNEL,
  ELECTRON_UPDATER_IPC_CHANNELS,
  ELECTRON_WINDOW_IPC_CHANNEL,
  ELECTRON_WINDOW_IPC_CHANNELS,
} from "../dist/shared/index.js";
import { createDesktopPlatformApi } from "../dist/renderer/platform/index.js";

// --- IPC channel 对象 frozen + 命名规范 ---
assert.equal(Object.isFrozen(ELECTRON_WINDOW_IPC_CHANNEL), true);
assert.equal(Object.isFrozen(ELECTRON_UPDATER_IPC_CHANNEL), true);
assert.equal(Object.isFrozen(ELECTRON_SYSTEM_TRAY_IPC_CHANNEL), true);
assert.equal(Object.isFrozen(ELECTRON_NATIVE_FILE_IPC_CHANNEL), true);

const windowChannelValues = Object.values(ELECTRON_WINDOW_IPC_CHANNEL);
for (const channel of windowChannelValues) {
  assert.match(channel, /^novel\.window\.v1\./, `window channel: ${channel}`);
}
const updaterChannelValues = Object.values(ELECTRON_UPDATER_IPC_CHANNEL);
for (const channel of updaterChannelValues) {
  assert.match(channel, /^novel\.updater\.v1\./, `updater channel: ${channel}`);
}
const trayChannelValues = Object.values(ELECTRON_SYSTEM_TRAY_IPC_CHANNEL);
for (const channel of trayChannelValues) {
  assert.match(channel, /^novel\.tray\.v1\./, `tray channel: ${channel}`);
}
const nativeFileChannelValues = Object.values(ELECTRON_NATIVE_FILE_IPC_CHANNEL);
for (const channel of nativeFileChannelValues) {
  assert.match(channel, /^novel\.file\.v1\./, `native file channel: ${channel}`);
}

assert.equal(ELECTRON_WINDOW_IPC_CHANNELS.length, 5);
assert.equal(ELECTRON_UPDATER_IPC_CHANNELS.length, 3);
assert.equal(ELECTRON_SYSTEM_TRAY_IPC_CHANNELS.length, 3);
assert.equal(ELECTRON_NATIVE_FILE_IPC_CHANNELS.length, 3);

// --- Shared FakeIpcMain ---
class FakeIpcMain {
  handlers = new Map();

  handle(channel, handler) {
    if (this.handlers.has(channel)) throw new Error(`duplicate channel: ${channel}`);
    this.handlers.set(channel, handler);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }

  async invoke(senderId, channel, ...args) {
    const handler = this.handlers.get(channel);
    if (handler === undefined) throw new Error(`missing IPC handler: ${channel}`);
    const result = await handler({ sender: { id: senderId } }, ...args);
    return JSON.parse(JSON.stringify(result));
  }
}

const authorizedSenderId = 1001;
const unauthorizedSenderId = 9999;
const authorizeSender = (senderId) => senderId === authorizedSenderId;

// --- Window port smoke ---
await assertWindowPortSmoke();
// --- Updater port smoke ---
await assertUpdaterPortSmoke();
// --- Tray port smoke ---
await assertTrayPortSmoke();
// --- Native file port smoke ---
await assertNativeFilePortSmoke();
// --- Renderer platform API aggregate ---
await assertPlatformApiAggregate();

console.log("electron desktop ports smoke passed");

async function assertWindowPortSmoke() {
  const windowState = {
    minimized: false,
    maximized: false,
    closed: false,
    alwaysOnTop: false,
    fullscreen: false,
    destroyed: false,
  };
  const fakeWindow = {
    minimize: () => {
      windowState.minimized = true;
    },
    maximize: () => {
      windowState.maximized = true;
    },
    isMaximized: () => windowState.maximized,
    close: () => {
      windowState.closed = true;
    },
    setAlwaysOnTop: (value) => {
      windowState.alwaysOnTop = value;
    },
    setFullscreen: (value) => {
      windowState.fullscreen = value;
    },
    isDestroyed: () => windowState.destroyed,
  };
  const service = new DesktopWindowService({
    resolver: {
      getPrimaryWindow: () => (windowState.destroyed ? undefined : fakeWindow),
    },
  });
  const ipcMain = new FakeIpcMain();
  const controller = new DesktopWindowIpcController({ service, authorizeSender });
  controller.register(ipcMain);

  // 所有 5 个通道已注册
  assert.deepEqual(
    new Set(ipcMain.handlers.keys()),
    new Set(ELECTRON_WINDOW_IPC_CHANNELS),
  );

  // 未授权 sender
  const unauthorized = await ipcMain.invoke(
    unauthorizedSenderId,
    ELECTRON_WINDOW_IPC_CHANNEL.minimize,
  );
  assert.deepEqual(unauthorized, {
    ok: false,
    error: { code: "ELECTRON_IPC_UNAUTHORIZED", retryable: false },
  });
  assert.equal(windowState.minimized, false);

  // 授权 sender - minimize
  const minimizeResult = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_WINDOW_IPC_CHANNEL.minimize,
  );
  assert.deepEqual(minimizeResult, {
    ok: true,
    value: { acknowledged: true },
  });
  assert.equal(windowState.minimized, true);

  // 授权 sender - setAlwaysOnTop(true)
  await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_WINDOW_IPC_CHANNEL.alwaysOnTopSet,
    true,
  );
  assert.equal(windowState.alwaysOnTop, true);

  // 授权 sender - setFullscreen(false) 协议错误（参数类型错）
  const protocolError = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_WINDOW_IPC_CHANNEL.fullscreenSet,
    "not-a-boolean",
  );
  assert.equal(protocolError.ok, false);
  assert.equal(protocolError.error.code, "ELECTRON_WINDOW_IPC_PROTOCOL_ERROR");

  // window 不可用时 ELECTRON_WINDOW_NOT_AVAILABLE
  windowState.destroyed = true;
  const unavailable = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_WINDOW_IPC_CHANNEL.maximize,
  );
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, "ELECTRON_WINDOW_NOT_AVAILABLE");
  assert.equal(unavailable.error.retryable, true);

  // dispose 移除所有 handler
  await controller.dispose();
  assert.equal(ipcMain.handlers.size, 0);
}

async function assertUpdaterPortSmoke() {
  const updaterState = {
    checked: false,
    downloaded: false,
    quitAndInstalled: false,
    nextResult: undefined,
  };
  const autoUpdater = {
    checkForUpdates: async () => {
      updaterState.checked = true;
      return updaterState.nextResult;
    },
    downloadUpdate: async () => {
      updaterState.downloaded = true;
    },
    quitAndInstall: () => {
      updaterState.quitAndInstalled = true;
    },
  };
  const service = new DesktopUpdaterService({ autoUpdater });
  const ipcMain = new FakeIpcMain();
  const controller = new DesktopUpdaterIpcController({ service, authorizeSender });
  controller.register(ipcMain);

  assert.deepEqual(
    new Set(ipcMain.handlers.keys()),
    new Set(ELECTRON_UPDATER_IPC_CHANNELS),
  );

  // 未授权
  const unauthorized = await ipcMain.invoke(
    unauthorizedSenderId,
    ELECTRON_UPDATER_IPC_CHANNEL.check,
  );
  assert.deepEqual(unauthorized, {
    ok: false,
    error: { code: "ELECTRON_IPC_UNAUTHORIZED", retryable: false },
  });

  // 授权 - 无更新（JSON 序列化会丢 undefined 字段，所以只验证 ok）
  updaterState.nextResult = undefined;
  const noUpdate = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_UPDATER_IPC_CHANNEL.check,
  );
  assert.equal(noUpdate.ok, true);
  assert.equal(noUpdate.value, undefined);
  assert.equal(updaterState.checked, true);

  // 授权 - 有更新
  updaterState.nextResult = {
    updateInfo: {
      version: "1.2.3",
      releaseNotes: "fixes",
      releaseDate: "2026-08-06",
    },
  };
  const hasUpdate = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_UPDATER_IPC_CHANNEL.check,
  );
  assert.deepEqual(hasUpdate, {
    ok: true,
    value: {
      version: "1.2.3",
      releaseNotes: "fixes",
      releaseDate: "2026-08-06",
    },
  });

  // 授权 - download
  const downloadResult = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_UPDATER_IPC_CHANNEL.download,
  );
  assert.deepEqual(downloadResult, {
    ok: true,
    value: { acknowledged: true },
  });
  assert.equal(updaterState.downloaded, true);

  // 授权 - quitAndInstall
  await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_UPDATER_IPC_CHANNEL.quitAndInstall,
  );
  assert.equal(updaterState.quitAndInstalled, true);

  // autoUpdater 抛错 -> 包装
  const failingUpdater = {
    checkForUpdates: async () => {
      throw Object.assign(new Error("network"), {
        code: "DESKTOP_UPDATER_NETWORK_FAILED",
      });
    },
    downloadUpdate: async () => {},
    quitAndInstall: () => {},
  };
  const failingService = new DesktopUpdaterService({
    autoUpdater: failingUpdater,
  });
  const failingController = new DesktopUpdaterIpcController({
    service: failingService,
    authorizeSender,
  });
  const failingIpc = new FakeIpcMain();
  failingController.register(failingIpc);
  const errorResult = await failingIpc.invoke(
    authorizedSenderId,
    ELECTRON_UPDATER_IPC_CHANNEL.check,
  );
  assert.equal(errorResult.ok, false);
  assert.equal(errorResult.error.code, "DESKTOP_UPDATER_NETWORK_FAILED");

  await controller.dispose();
  assert.equal(ipcMain.handlers.size, 0);
}

async function assertTrayPortSmoke() {
  const trayState = {
    created: false,
    imageSet: "",
    menuSet: [],
    notifications: [],
    destroyed: false,
  };
  const trayFactory = {
    create: (iconPath) => {
      trayState.created = true;
      trayState.imageSet = iconPath;
      return {
        setImage: (path) => {
          trayState.imageSet = path;
        },
        setToolTip: () => {},
        setContextMenu: (items) => {
          trayState.menuSet = items;
        },
        displayBalloon: (options) => {
          trayState.notifications.push({ kind: "balloon", ...options });
        },
        destroy: () => {
          trayState.destroyed = true;
        },
        isDestroyed: () => trayState.destroyed,
      };
    },
  };
  const notification = {
    show: (options) => {
      trayState.notifications.push({ kind: "notification", ...options });
    },
  };
  const service = new DesktopSystemTrayService({ trayFactory, notification });
  const ipcMain = new FakeIpcMain();
  const controller = new DesktopSystemTrayIpcController({
    service,
    authorizeSender,
  });
  controller.register(ipcMain);

  assert.deepEqual(
    new Set(ipcMain.handlers.keys()),
    new Set(ELECTRON_SYSTEM_TRAY_IPC_CHANNELS),
  );

  // 未授权
  const unauthorized = await ipcMain.invoke(
    unauthorizedSenderId,
    ELECTRON_SYSTEM_TRAY_IPC_CHANNEL.iconSet,
    "/path/to/icon.png",
  );
  assert.deepEqual(unauthorized, {
    ok: false,
    error: { code: "ELECTRON_IPC_UNAUTHORIZED", retryable: false },
  });

  // 授权 - setTrayIcon
  const iconResult = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_SYSTEM_TRAY_IPC_CHANNEL.iconSet,
    "/path/to/icon.png",
  );
  assert.deepEqual(iconResult, {
    ok: true,
    value: { acknowledged: true },
  });
  assert.equal(trayState.created, true);
  assert.equal(trayState.imageSet, "/path/to/icon.png");

  // 授权 - setTrayMenu
  const menuItems = [
    { id: "open", label: "打开" },
    { id: "sep1", label: "", separator: true },
    { id: "quit", label: "退出", enabled: true },
  ];
  const menuResult = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_SYSTEM_TRAY_IPC_CHANNEL.menuSet,
    menuItems,
  );
  assert.deepEqual(menuResult, {
    ok: true,
    value: { acknowledged: true },
  });
  assert.equal(trayState.menuSet.length, 3);
  assert.equal(trayState.menuSet[0].id, "open");

  // 授权 - showTrayNotification
  await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_SYSTEM_TRAY_IPC_CHANNEL.notificationShow,
    { title: "更新可用", body: "新版本 v1.2.3" },
  );
  assert.equal(trayState.notifications.length, 1);
  assert.equal(trayState.notifications[0].title, "更新可用");

  // 协议错误：notification.title 缺失
  const protocolError = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_SYSTEM_TRAY_IPC_CHANNEL.notificationShow,
    { body: "missing title" },
  );
  assert.equal(protocolError.ok, false);
  assert.equal(
    protocolError.error.code,
    "ELECTRON_SYSTEM_TRAY_IPC_PROTOCOL_ERROR",
  );

  // 空 iconPath 走 graceful degradation（不抛错）
  const emptyIcon = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_SYSTEM_TRAY_IPC_CHANNEL.iconSet,
    "  ",
  );
  // requireNonBlank 应触发协议错误
  assert.equal(emptyIcon.ok, false);
  assert.equal(emptyIcon.error.code, "ELECTRON_SYSTEM_TRAY_IPC_PROTOCOL_ERROR");

  await controller.dispose();
  assert.equal(ipcMain.handlers.size, 0);
}

async function assertNativeFilePortSmoke() {
  const dialogState = {
    nextPaths: [],
    capturedOptions: [],
  };
  const shellState = {
    openedPaths: [],
  };
  const dialog = {
    showOpenDialog: async (options) => {
      dialogState.capturedOptions.push(options);
      const paths = dialogState.nextPaths.shift() ?? [];
      return paths.length === 0 ? undefined : paths;
    },
  };
  const shell = {
    openPath: async (path) => {
      shellState.openedPaths.push(path);
      return "";
    },
  };
  const service = new DesktopNativeFileService({ dialog, shell });
  const ipcMain = new FakeIpcMain();
  const controller = new DesktopNativeFileIpcController({
    service,
    authorizeSender,
  });
  controller.register(ipcMain);

  assert.deepEqual(
    new Set(ipcMain.handlers.keys()),
    new Set(ELECTRON_NATIVE_FILE_IPC_CHANNELS),
  );

  // 未授权
  const unauthorized = await ipcMain.invoke(
    unauthorizedSenderId,
    ELECTRON_NATIVE_FILE_IPC_CHANNEL.selectFile,
    undefined,
  );
  assert.deepEqual(unauthorized, {
    ok: false,
    error: { code: "ELECTRON_IPC_UNAUTHORIZED", retryable: false },
  });

  // 授权 - selectFile 返回 FrontendFileReference[]
  dialogState.nextPaths.push(["/tmp/file-a.txt", "/tmp/file-b.md"]);
  const fileResult = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_NATIVE_FILE_IPC_CHANNEL.selectFile,
    { multiple: true, accept: [".txt", ".md"] },
  );
  assert.equal(fileResult.ok, true);
  assert.equal(Array.isArray(fileResult.value), true);
  assert.equal(fileResult.value.length, 2);
  assert.equal(fileResult.value[0].name, "file-a.txt");
  assert.equal(typeof fileResult.value[0].id, "string");
  assert.equal(fileResult.value[0].mediaType, "text/plain");
  assert.equal(fileResult.value[1].mediaType, "text/markdown");

  // 授权 - selectDirectory
  dialogState.nextPaths.push(["/Users/test/workspace"]);
  const dirResult = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_NATIVE_FILE_IPC_CHANNEL.selectDirectory,
    undefined,
  );
  assert.equal(dirResult.ok, true);
  assert.equal(dirResult.value.length, 1);
  assert.equal(dirResult.value[0].name, "workspace");

  // 授权 - previewFile（使用上面返回的 referenceId）
  const referenceId = fileResult.value[0].id;
  const previewResult = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_NATIVE_FILE_IPC_CHANNEL.preview,
    referenceId,
  );
  assert.deepEqual(previewResult, {
    ok: true,
    value: { acknowledged: true },
  });
  assert.equal(shellState.openedPaths[0], "/tmp/file-a.txt");

  // previewFile with unknown referenceId -> DESKTOP_NATIVE_FILE_REFERENCE_NOT_FOUND
  const unknownPreview = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_NATIVE_FILE_IPC_CHANNEL.preview,
    "non-existent-id",
  );
  assert.equal(unknownPreview.ok, false);
  assert.equal(
    unknownPreview.error.code,
    "DESKTOP_NATIVE_FILE_REFERENCE_NOT_FOUND",
  );

  // 空 referenceId 协议错误
  const blankPreview = await ipcMain.invoke(
    authorizedSenderId,
    ELECTRON_NATIVE_FILE_IPC_CHANNEL.preview,
    "  ",
  );
  assert.equal(blankPreview.ok, false);
  assert.equal(
    blankPreview.error.code,
    "ELECTRON_NATIVE_FILE_IPC_PROTOCOL_ERROR",
  );

  await controller.dispose();
  assert.equal(ipcMain.handlers.size, 0);
}

async function assertPlatformApiAggregate() {
  // 子 bridge 全部存在 -> 4 个 port 都构造
  const fullBridge = createFakeBridge({
    window: true,
    updater: true,
    tray: true,
    files: true,
  });
  const fullApi = createDesktopPlatformApi(fullBridge);
  assert.equal(Object.isFrozen(fullApi), true);
  assert.equal(typeof fullApi.window?.minimize, "function");
  assert.equal(typeof fullApi.updater?.checkForUpdates, "function");
  assert.equal(typeof fullApi.tray?.setTrayIcon, "function");
  assert.equal(typeof fullApi.files?.selectFile, "function");

  // 子 bridge 全部缺失 -> 全 undefined
  const emptyBridge = createFakeBridge({
    window: false,
    updater: false,
    tray: false,
    files: false,
  });
  const emptyApi = createDesktopPlatformApi(emptyBridge);
  assert.equal(emptyApi.window, undefined);
  assert.equal(emptyApi.updater, undefined);
  assert.equal(emptyApi.tray, undefined);
  assert.equal(emptyApi.files, undefined);

  // 部分缺失 -> 对应 port 为 undefined，其它仍构造
  const partialBridge = createFakeBridge({
    window: true,
    updater: false,
    tray: true,
    files: false,
  });
  const partialApi = createDesktopPlatformApi(partialBridge);
  assert.equal(typeof partialApi.window?.minimize, "function");
  assert.equal(partialApi.updater, undefined);
  assert.equal(typeof partialApi.tray?.setTrayIcon, "function");
  assert.equal(partialApi.files, undefined);

  // renderer port unwrap() 在 { ok: false } 时抛 ApiTransportError
  const failingBridge = createFakeBridge({
    window: true,
    updater: false,
    tray: false,
    files: false,
  }, { failWindow: true });
  const failingApi = createDesktopPlatformApi(failingBridge);
  await assert.rejects(
    failingApi.window.minimize(),
    (error) => error instanceof ApiTransportError,
  );
}

function createFakeBridge(flags, behavior = {}) {
  const bridge = {};
  if (flags.window) {
    bridge.window = {
      minimize: async () =>
        behavior.failWindow
          ? { ok: false, error: { code: "ELECTRON_WINDOW_OPERATION_FAILED", retryable: true } }
          : { ok: true, value: { acknowledged: true } },
      maximize: async () => ({ ok: true, value: { acknowledged: true } }),
      close: async () => ({ ok: true, value: { acknowledged: true } }),
      setAlwaysOnTop: async () => ({ ok: true, value: { acknowledged: true } }),
      setFullscreen: async () => ({ ok: true, value: { acknowledged: true } }),
    };
  }
  if (flags.updater) {
    bridge.updater = {
      checkForUpdates: async () => ({ ok: true, value: undefined }),
      downloadUpdate: async () => ({ ok: true, value: { acknowledged: true } }),
      quitAndInstall: async () => ({ ok: true, value: { acknowledged: true } }),
    };
  }
  if (flags.tray) {
    bridge.tray = {
      setTrayIcon: async () => ({ ok: true, value: { acknowledged: true } }),
      setTrayMenu: async () => ({ ok: true, value: { acknowledged: true } }),
      showTrayNotification: async () => ({ ok: true, value: { acknowledged: true } }),
    };
  }
  if (flags.files) {
    bridge.files = {
      selectFile: async () => ({ ok: true, value: [] }),
      selectDirectory: async () => ({ ok: true, value: [] }),
      previewFile: async () => ({ ok: true, value: { acknowledged: true } }),
    };
  }
  return bridge;
}
