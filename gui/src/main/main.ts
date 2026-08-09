/** Launches the built secure Electron desktop application. */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  autoUpdater,
  dialog,
  Menu,
  Notification,
  safeStorage,
  shell,
  Tray,
} from "electron";
import {
  NodeApplicationConfigurationStore,
  NodeConfigurationHomeResolver,
  NodeCredentialMigrationStateStore,
  NodeEncryptedCredentialStore,
  NodeLegacyCredentialMigrator,
  NodePlaintextCredentialStore,
  NodeWorkspaceStoreLocator,
} from "@novel/core/node";
import { ELECTRON_WORKSPACE_IPC_CHANNEL } from "../shared/ElectronIpcProtocol.js";
import { DesktopBootstrapApiTransport } from "./DesktopBootstrapApiTransport.js";
import { createDesktopApplicationMenuTemplate } from "./DesktopApplicationMenu.js";
import { resolveDesktopMainPaths } from "./DesktopMainPaths.js";
import {
  DesktopConfigurationService,
  DesktopCredentialMigrationCoordinator,
  ElectronSafeStorageCredentialCipher,
} from "./config/index.js";
import { createElectronDesktopApplication } from "./createElectronDesktopApplication.js";
import { createMainProcessLogger } from "./MainProcessLogger.js";
import type { DesktopApplication } from "./DesktopApplication.js";
import {
  DesktopNovelWorkspaceApplicationFactory,
  DesktopWorkspaceRecentStore,
  DesktopWorkspaceService,
} from "./workspace/index.js";
import {
  DesktopNativeFileService,
  DesktopSystemTrayService,
  DesktopUpdaterService,
  DesktopWindowService,
  type ElectronAutoUpdaterPort,
  type ElectronNotificationPort,
  type ElectronTrayFactory,
  type ElectronTrayPort,
} from "./desktop/index.js";
import { DesktopDesignFileService } from "./desktop/design/index.js";

const paths = resolveDesktopMainPaths(import.meta.url);
const buildMode = await readBuildMode(import.meta.url);
const manualDebug = process.env.NOVEL_DEBUG;
const manualDump = process.env.NOVEL_PROVIDER_REQUEST_DUMP;
const debugLogLevel =
  manualDebug === "verbose"
    ? "verbose"
    : manualDebug === "1" || manualDebug === "debug"
      ? "debug"
      : buildMode === "debug"
        ? "verbose"
        : undefined;
const providerRequestDumpPath =
  manualDump ??
  (buildMode === "debug"
    ? join(app.getPath("userData"), "debug", "provider-requests.jsonl")
    : undefined);
const configurationHome = new NodeConfigurationHomeResolver();
const configurationStore = new NodeApplicationConfigurationStore({
  homeResolver: configurationHome,
});
const plaintextCredentialStore = new NodePlaintextCredentialStore({
  homeResolver: configurationHome,
});
const legacyCredentialStore = new NodeEncryptedCredentialStore({
  homeResolver: configurationHome,
  cipher: new ElectronSafeStorageCredentialCipher({ safeStorage }),
});
const credentialMigration = new DesktopCredentialMigrationCoordinator({
  store: configurationStore,
  migrator: new NodeLegacyCredentialMigrator({
    legacyStore: legacyCredentialStore,
    plaintextStore: plaintextCredentialStore,
    stateStore: new NodeCredentialMigrationStateStore({
      homeResolver: configurationHome,
    }),
  }),
});
const configurationService = new DesktopConfigurationService({
  store: configurationStore,
  credentials: plaintextCredentialStore,
});
const mainLogger = createMainProcessLogger(
  join(app.getPath("userData"), "runtime-main.log"),
);
const workspaceService = new DesktopWorkspaceService({
  picker: {
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog({
        title: "打开小说项目文件夹",
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
  },
  locator: new NodeWorkspaceStoreLocator({
    storageRoot: join(app.getPath("userData"), "novel-storage"),
  }),
  applicationFactory: new DesktopNovelWorkspaceApplicationFactory({
    storageRoot: join(app.getPath("userData"), "novel-storage"),
    childLogPath: join(app.getPath("userData"), "runtime-child.log"),
    logger: mainLogger,
    ...(debugLogLevel === undefined ? {} : { debugLogLevel }),
    ...(providerRequestDumpPath === undefined
      ? {}
      : { providerRequestDumpPath }),
  }),
  onOpened: (senderId, session) => {
    const window =
      desktopApplicationRef?.windowManager.getWindowBySender(senderId) ??
      desktopApplicationRef?.windowManager.getPrimaryWindow();
    window?.webContents.send(ELECTRON_WORKSPACE_IPC_CHANNEL.opened, session);
  },
  recentStore: new DesktopWorkspaceRecentStore({
    filePath: join(app.getPath("userData"), "workspace-recent.json"),
    logger: mainLogger,
  }),
});
const bootstrapTransport = new DesktopBootstrapApiTransport();

// 桌面 4 个 platform service（spec 5.4）。windowService 用 closure 懒解析
// application.windowManager：因为 DesktopApplication 内部构造 windowManager，
// 必须在 application 创建后才能拿到引用。其它 3 个 service 不依赖 windowManager。
let desktopApplicationRef: DesktopApplication | undefined;
const windowService = new DesktopWindowService({
  resolver: {
    getPrimaryWindow: () => desktopApplicationRef?.windowManager.getPrimaryWindow(),
    getWindowBySender: (senderId) =>
      desktopApplicationRef?.windowManager.getWindowBySender(senderId),
  },
});
const updaterService = new DesktopUpdaterService({
  autoUpdater: autoUpdater as unknown as ElectronAutoUpdaterPort,
});
const trayService = new DesktopSystemTrayService({
  trayFactory: createElectronTrayFactory(),
  notification: createElectronNotificationAdapter(),
});
const nativeFileService = new DesktopNativeFileService({
  dialog: {
    showOpenDialog: async (options) => {
      const result = await dialog.showOpenDialog(
        options as Parameters<typeof dialog.showOpenDialog>[0],
      );
      return result.canceled ? undefined : result.filePaths;
    },
  },
  shell: {
    openPath: async (path) => shell.openPath(path),
  },
});
const designService = new DesktopDesignFileService({
  resolveWorkspaceRoot: (senderId) =>
    workspaceService.getCurrentWorkspaceRoot(senderId),
});
const application = createElectronDesktopApplication({
  resolveTransport: (senderId) =>
    workspaceService.resolveTransport(senderId) ?? bootstrapTransport,
  preloadPath: paths.preloadPath,
  rendererTarget: { kind: "file", filePath: paths.rendererFilePath },
  workspaceService,
  configurationService,
  windowService,
  updaterService,
  trayService,
  nativeFileService,
  designService,
});
desktopApplicationRef = application;
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    ...createDesktopApplicationMenuTemplate({
      applicationName: "Novel",
      platform: process.platform,
      dispatch: (command) => {
        application.dispatchCommand(command);
      },
      openNewWindow: () => {
        void application.openNewWindow().catch(() => {
          // 新窗口打开失败（如 load 异常）时保持现状，不阻塞菜单。
        });
      },
    }),
  ]),
);

let stopping = false;
app.on("before-quit", (event) => {
  if (stopping) return;
  event.preventDefault();
  stopping = true;
  void application.stop().finally(() => app.quit());
});

void startDesktopApplication().catch(() => {
  console.error(
    JSON.stringify({ level: "error", event: "desktop_main.start_failed" }),
  );
  app.quit();
});

async function startDesktopApplication(): Promise<void> {
  await app.whenReady();
  await credentialMigration.migrateKnownCredentials();
  await application.start();
}

async function readBuildMode(entryModuleUrl: string): Promise<"debug" | "release"> {
  try {
    const raw = await readFile(
      join(dirname(fileURLToPath(entryModuleUrl)), "..", "build-mode.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { mode?: string };
    return parsed.mode === "debug" ? "debug" : "release";
  } catch {
    return "release";
  }
}

/**
 * Electron Tray 工厂（spec 5.4 DesktopSystemTrayPort）。
 *
 * 仓库内暂无图标资产：path 为空 / 文件不存在时返回 undefined，service 据此
 * 跳过 tray 创建（graceful degradation）。后续接入图标资产后无需改代码。
 */
function createElectronTrayFactory(): ElectronTrayFactory {
  return Object.freeze({
    create: (iconPath: string): ElectronTrayPort | undefined => {
      if (typeof iconPath !== "string" || iconPath.trim().length === 0) return undefined;
      try {
        const tray = new Tray(iconPath);
        return {
          setImage: (path) => tray.setImage(path),
          setToolTip: (text) => tray.setToolTip(text),
          setContextMenu: (items) => {
            const menu = Menu.buildFromTemplate(
              items.map((item) => ({
                id: item.id,
                label: item.label,
                type: item.separator === true ? "separator" : undefined,
                enabled: item.enabled,
              })),
            );
            tray.setContextMenu(menu);
          },
          displayBalloon: (options) => {
            tray.displayBalloon({
              title: options.title ?? "",
              content: options.content ?? "",
            });
          },
          destroy: () => tray.destroy(),
          isDestroyed: () => tray.isDestroyed(),
        };
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "desktop_main.tray_create_failed",
            error: String(error),
          }),
        );
        return undefined;
      }
    },
  });
}

/**
 * Electron Notification 跨平台适配（spec 5.4 DesktopSystemTrayPort）。
 *
 * 使用 Electron Notification API；在 Windows 上 tray.displayBalloon 也可用，
 * 但 Notification 在所有平台行为一致，作为统一入口。
 */
function createElectronNotificationAdapter(): ElectronNotificationPort {
  return Object.freeze({
    show: (options: { readonly title: string; readonly body?: string }) => {
      const notification = new Notification({
        title: options.title,
        ...(options.body !== undefined ? { body: options.body } : {}),
      });
      notification.show();
    },
  });
}
