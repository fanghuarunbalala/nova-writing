/** Binds real Electron Main APIs to the testable desktop application ports. */
import { app, BrowserWindow, ipcMain } from "electron";
import type { ApiTransport, Logger } from "@novel/core";
import { DesktopApplication } from "./DesktopApplication.js";
import type {
  DesktopBrowserWindowPort,
  DesktopRendererTarget,
} from "./DesktopWindowManager.js";
import type { DesktopConfigurationServicePort } from "./config/index.js";
import type { DesktopWorkspaceServicePort } from "./workspace/index.js";
import type { DesktopNativeFileServicePort } from "./desktop/nativefile/index.js";
import type { DesktopWindowServicePort } from "./desktop/window/index.js";
import type { DesktopUpdaterServicePort } from "./desktop/updater/index.js";
import type { DesktopSystemTrayServicePort } from "./desktop/tray/index.js";

export interface CreateElectronDesktopApplicationOptions {
  readonly transport?: ApiTransport;
  readonly resolveTransport?: (senderId: number) => ApiTransport;
  readonly preloadPath: string;
  readonly rendererTarget: DesktopRendererTarget;
  readonly isNavigationAllowed?: (url: string) => boolean;
  readonly logger?: Logger;
  readonly workspaceService?: DesktopWorkspaceServicePort;
  readonly configurationService?: DesktopConfigurationServicePort;
  readonly windowService?: DesktopWindowServicePort;
  readonly updaterService?: DesktopUpdaterServicePort;
  readonly trayService?: DesktopSystemTrayServicePort;
  readonly nativeFileService?: DesktopNativeFileServicePort;
}

export function createElectronDesktopApplication(
  options: CreateElectronDesktopApplicationOptions,
): DesktopApplication {
  return new DesktopApplication({
    app: {
      whenReady: () => app.whenReady(),
      on: (event, listener) => {
        if (event === "activate") app.on("activate", listener);
        else app.on("window-all-closed", listener);
      },
      off: (event, listener) => {
        if (event === "activate") app.off("activate", listener);
        else app.off("window-all-closed", listener);
      },
      quit: () => app.quit(),
    },
    ipcMain: {
      handle: (channel, handler) =>
        ipcMain.handle(channel, (event, ...args) => handler(event, ...args)),
      removeHandler: (channel) => ipcMain.removeHandler(channel),
    },
    ...(options.transport !== undefined ? { transport: options.transport } : {}),
    ...(options.resolveTransport !== undefined
      ? { resolveTransport: options.resolveTransport }
      : {}),
    createWindow: (windowOptions) =>
      new BrowserWindow(windowOptions) as unknown as DesktopBrowserWindowPort,
    preloadPath: options.preloadPath,
    rendererTarget: options.rendererTarget,
    platform: process.platform,
    ...(options.isNavigationAllowed !== undefined
      ? { isNavigationAllowed: options.isNavigationAllowed }
      : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
    ...(options.workspaceService !== undefined
      ? { workspaceService: options.workspaceService }
      : {}),
    ...(options.configurationService !== undefined
      ? { configurationService: options.configurationService }
      : {}),
    ...(options.windowService !== undefined
      ? { windowService: options.windowService }
      : {}),
    ...(options.updaterService !== undefined
      ? { updaterService: options.updaterService }
      : {}),
    ...(options.trayService !== undefined ? { trayService: options.trayService } : {}),
    ...(options.nativeFileService !== undefined
      ? { nativeFileService: options.nativeFileService }
      : {}),
  });
}
