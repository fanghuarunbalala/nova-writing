/**
 * electron-desktop-ports-typecheck
 *
 * 编译期 proof：4 个桌面 platform port 全栈类型对齐（spec 5.4）。
 *
 * 验证：
 * - shared 层 4 个 port 接口 + bridge 接口 + IPC channel 对象
 * - main 层 4 个 service port + IPC controller 的 register/dispose 形态
 * - renderer 层 4 个 port factory + DesktopPlatformApi aggregate
 * - bridge 子 API 缺失时各 factory 返回 undefined
 */
import type { ElectronPreloadBridge } from "../src/shared/index.js";
import {
  ELECTRON_NATIVE_FILE_IPC_CHANNEL,
  ELECTRON_NATIVE_FILE_IPC_CHANNELS,
  ELECTRON_SYSTEM_TRAY_IPC_CHANNEL,
  ELECTRON_SYSTEM_TRAY_IPC_CHANNELS,
  ELECTRON_UPDATER_IPC_CHANNEL,
  ELECTRON_UPDATER_IPC_CHANNELS,
  ELECTRON_WINDOW_IPC_CHANNEL,
  ELECTRON_WINDOW_IPC_CHANNELS,
} from "../src/shared/index.js";
import type {
  DesktopNativeFilePort,
  DesktopPlatformApi,
  DesktopSystemTrayPort,
  DesktopUpdaterPort,
  DesktopWindowPort,
} from "../src/shared/index.js";
import {
  DesktopNativeFileIpcController,
  DesktopNativeFileService,
  type DesktopNativeFileServicePort,
} from "../src/main/desktop/nativefile/index.js";
import {
  DesktopWindowIpcController,
  DesktopWindowService,
  type DesktopWindowServicePort,
} from "../src/main/desktop/window/index.js";
import {
  DesktopUpdaterIpcController,
  DesktopUpdaterService,
  type DesktopUpdaterServicePort,
} from "../src/main/desktop/updater/index.js";
import {
  DesktopSystemTrayIpcController,
  DesktopSystemTrayService,
  type DesktopSystemTrayServicePort,
} from "../src/main/desktop/tray/index.js";
import type { ElectronIpcMainPort } from "../src/main/ipc/index.js";
import {
  createDesktopPlatformApi,
} from "../src/renderer/platform/index.js";

declare const bridge: ElectronPreloadBridge;
declare const ipcMain: ElectronIpcMainPort;
declare const authorizeSender: (senderId: number) => boolean;

// --- IPC channel objects frozen + 形态正确 ---
void ELECTRON_WINDOW_IPC_CHANNEL.minimize;
void ELECTRON_WINDOW_IPC_CHANNEL.maximize;
void ELECTRON_WINDOW_IPC_CHANNEL.close;
void ELECTRON_WINDOW_IPC_CHANNEL.alwaysOnTopSet;
void ELECTRON_WINDOW_IPC_CHANNEL.fullscreenSet;
void ELECTRON_WINDOW_IPC_CHANNELS;

void ELECTRON_UPDATER_IPC_CHANNEL.check;
void ELECTRON_UPDATER_IPC_CHANNEL.download;
void ELECTRON_UPDATER_IPC_CHANNEL.quitAndInstall;
void ELECTRON_UPDATER_IPC_CHANNELS;

void ELECTRON_SYSTEM_TRAY_IPC_CHANNEL.iconSet;
void ELECTRON_SYSTEM_TRAY_IPC_CHANNEL.menuSet;
void ELECTRON_SYSTEM_TRAY_IPC_CHANNEL.notificationShow;
void ELECTRON_SYSTEM_TRAY_IPC_CHANNELS;

void ELECTRON_NATIVE_FILE_IPC_CHANNEL.selectFile;
void ELECTRON_NATIVE_FILE_IPC_CHANNEL.selectDirectory;
void ELECTRON_NATIVE_FILE_IPC_CHANNEL.preview;
void ELECTRON_NATIVE_FILE_IPC_CHANNELS;

// --- Service ports + controllers 形态正确 ---
declare const windowService: DesktopWindowServicePort;
declare const updaterService: DesktopUpdaterServicePort;
declare const trayService: DesktopSystemTrayServicePort;
declare const nativeFileService: DesktopNativeFileServicePort;

const windowController = new DesktopWindowIpcController({
  service: windowService,
  authorizeSender,
});
windowController.register(ipcMain);
void windowController.releaseSender(1);
void windowController.dispose();

const updaterController = new DesktopUpdaterIpcController({
  service: updaterService,
  authorizeSender,
});
updaterController.register(ipcMain);
void updaterController.releaseSender(1);
void updaterController.dispose();

const trayController = new DesktopSystemTrayIpcController({
  service: trayService,
  authorizeSender,
});
trayController.register(ipcMain);
void trayController.releaseSender(1);
void trayController.dispose();

const nativeFileController = new DesktopNativeFileIpcController({
  service: nativeFileService,
  authorizeSender,
});
nativeFileController.register(ipcMain);
void nativeFileController.releaseSender(1);
void nativeFileController.dispose();

// --- Service 实例化（构造选项类型正确）---
import type { DesktopBrowserWindowPort } from "../src/main/DesktopWindowManager.js";
import type {
  DesktopDialogPort,
  DesktopShellPort,
  ElectronAutoUpdaterPort,
  ElectronNotificationPort,
  ElectronTrayFactory,
} from "../src/main/desktop/index.js";

const windowResolver: {
  getPrimaryWindow(): DesktopBrowserWindowPort | undefined;
} = {
  getPrimaryWindow: () => undefined,
};
void new DesktopWindowService({ resolver: windowResolver });

const autoUpdater: ElectronAutoUpdaterPort = {
  checkForUpdates: () => Promise.resolve(undefined),
  downloadUpdate: () => Promise.resolve(),
  quitAndInstall: () => {},
};
void new DesktopUpdaterService({ autoUpdater });

const trayFactory: ElectronTrayFactory = {
  create: () => undefined,
};
const notification: ElectronNotificationPort = {
  show: () => {},
};
void new DesktopSystemTrayService({ trayFactory, notification });

const dialog: DesktopDialogPort = {
  showOpenDialog: () => Promise.resolve(undefined),
};
const shell: DesktopShellPort = {
  openPath: () => Promise.resolve(""),
};
void new DesktopNativeFileService({ dialog, shell });

// --- Renderer platform API aggregate ---
const platformApi: DesktopPlatformApi = createDesktopPlatformApi(bridge);
const windowPort: DesktopWindowPort | undefined = platformApi.window;
const updaterPort: DesktopUpdaterPort | undefined = platformApi.updater;
const trayPort: DesktopSystemTrayPort | undefined = platformApi.tray;
const filesPort: DesktopNativeFilePort | undefined = platformApi.files;
void windowPort;
void updaterPort;
void trayPort;
void filesPort;
