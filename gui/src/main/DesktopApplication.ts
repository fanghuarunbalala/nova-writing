/** Coordinates Electron App lifecycle, secure windows, and the IPC Controller. */
import { ApiTransportError, noopLogger, type ApiTransport, type Logger } from "@novel/core";
import type { BrowserWindowConstructorOptions } from "electron";
import type { ElectronApplicationCommand } from "../shared/index.js";
import {
  DesktopConfigurationIpcController,
  type DesktopConfigurationServicePort,
} from "./config/index.js";
import { DesktopApiIpcController, type ElectronIpcMainPort } from "./ipc/index.js";
import {
  DesktopWorkspaceIpcController,
  type DesktopWorkspaceServicePort,
} from "./workspace/index.js";
import {
  DesktopNativeFileIpcController,
  type DesktopNativeFileServicePort,
} from "./desktop/nativefile/index.js";
import {
  DesktopDesignIpcController,
  type DesktopDesignFileServicePort,
} from "./desktop/design/index.js";
import {
  DesktopWindowIpcController,
  type DesktopWindowServicePort,
} from "./desktop/window/index.js";
import {
  DesktopUpdaterIpcController,
  type DesktopUpdaterServicePort,
} from "./desktop/updater/index.js";
import {
  DesktopSystemTrayIpcController,
  type DesktopSystemTrayServicePort,
} from "./desktop/tray/index.js";
import {
  DesktopWindowManager,
  type DesktopBrowserWindowPort,
  type DesktopRendererTarget,
} from "./DesktopWindowManager.js";

export interface ElectronAppPort {
  whenReady(): Promise<void>;
  on(event: "activate" | "window-all-closed", listener: () => void): void;
  off(event: "activate" | "window-all-closed", listener: () => void): void;
  quit(): void;
}

export interface DesktopApplicationOptions {
  readonly app: ElectronAppPort;
  readonly ipcMain: ElectronIpcMainPort;
  readonly transport?: ApiTransport;
  readonly resolveTransport?: (senderId: number) => ApiTransport;
  readonly createWindow: (
    options: BrowserWindowConstructorOptions,
  ) => DesktopBrowserWindowPort;
  readonly preloadPath: string;
  readonly rendererTarget: DesktopRendererTarget;
  readonly platform: string;
  readonly isNavigationAllowed?: (url: string) => boolean;
  readonly logger?: Logger;
  readonly workspaceService?: DesktopWorkspaceServicePort;
  readonly configurationService?: DesktopConfigurationServicePort;
  readonly windowService?: DesktopWindowServicePort;
  readonly updaterService?: DesktopUpdaterServicePort;
  readonly trayService?: DesktopSystemTrayServicePort;
  readonly nativeFileService?: DesktopNativeFileServicePort;
  readonly designService?: DesktopDesignFileServicePort;
}

export class DesktopApplication {
  readonly windowManager: DesktopWindowManager;

  private readonly app: ElectronAppPort;
  private readonly ipcMain: ElectronIpcMainPort;
  private readonly controller: DesktopApiIpcController;
  private readonly workspaceController?: DesktopWorkspaceIpcController;
  private readonly configurationController?: DesktopConfigurationIpcController;
  private readonly windowController?: DesktopWindowIpcController;
  private readonly updaterController?: DesktopUpdaterIpcController;
  private readonly trayController?: DesktopSystemTrayIpcController;
  private readonly nativeFileController?: DesktopNativeFileIpcController;
  private readonly designController?: DesktopDesignIpcController;
  private readonly platform: string;
  private readonly logger: Logger;
  private started = false;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;

  constructor(options: DesktopApplicationOptions) {
    this.app = options.app;
    this.ipcMain = options.ipcMain;
    this.platform = options.platform;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_application",
    });
    let windowManager: DesktopWindowManager;
    const authorizeSender = (senderId: number) => windowManager.ownsSender(senderId);
    this.controller = new DesktopApiIpcController({
      ...(options.transport !== undefined ? { transport: options.transport } : {}),
      ...(options.resolveTransport !== undefined
        ? { resolveTransport: options.resolveTransport }
        : {}),
      authorizeSender,
      logger: this.logger,
    });
    this.workspaceController =
      options.workspaceService === undefined
        ? undefined
        : new DesktopWorkspaceIpcController({
            service: options.workspaceService,
            authorizeSender,
            logger: this.logger,
          });
    this.configurationController = options.configurationService === undefined
      ? undefined
      : new DesktopConfigurationIpcController({
        service: options.configurationService,
        authorizeSender,
        logger: this.logger,
      });
    this.windowController = options.windowService === undefined
      ? undefined
      : new DesktopWindowIpcController({
        service: options.windowService,
        authorizeSender,
        logger: this.logger,
      });
    this.updaterController = options.updaterService === undefined
      ? undefined
      : new DesktopUpdaterIpcController({
        service: options.updaterService,
        authorizeSender,
        logger: this.logger,
      });
    this.trayController = options.trayService === undefined
      ? undefined
      : new DesktopSystemTrayIpcController({
        service: options.trayService,
        authorizeSender,
        logger: this.logger,
      });
    this.nativeFileController = options.nativeFileService === undefined
      ? undefined
      : new DesktopNativeFileIpcController({
        service: options.nativeFileService,
        authorizeSender,
        logger: this.logger,
      });
    this.designController = options.designService === undefined
      ? undefined
      : new DesktopDesignIpcController({
        service: options.designService,
        authorizeSender,
        logger: this.logger,
      });
    windowManager = new DesktopWindowManager({
      preloadPath: options.preloadPath,
      rendererTarget: options.rendererTarget,
      createWindow: options.createWindow,
      releaseSender: async (senderId) => {
        await Promise.all([
          this.controller.releaseSender(senderId),
          this.workspaceController?.releaseSender(senderId),
          this.windowController?.releaseSender(senderId),
          this.updaterController?.releaseSender(senderId),
          this.trayController?.releaseSender(senderId),
          this.nativeFileController?.releaseSender(senderId),
          this.designController?.releaseSender(senderId),
        ]);
      },
      ...(options.isNavigationAllowed !== undefined
        ? { isNavigationAllowed: options.isNavigationAllowed }
        : {}),
      logger: this.logger,
    });
    this.windowManager = windowManager;
  }

  start(): Promise<void> {
    this.startPromise ??= this.startOnce();
    return this.startPromise;
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.stopOnce();
    return this.stopPromise;
  }

  dispatchCommand(command: ElectronApplicationCommand): boolean {
    return this.windowManager.dispatchCommand(command);
  }

  /** 菜单「新建项目…」：新开一个窗口（显示项目选择页）。 */
  openNewWindow(): Promise<DesktopBrowserWindowPort> {
    return this.windowManager.openWindow();
  }

  private async startOnce(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.controller.register(this.ipcMain);
    this.workspaceController?.register(this.ipcMain);
    this.configurationController?.register(this.ipcMain);
    this.windowController?.register(this.ipcMain);
    this.updaterController?.register(this.ipcMain);
    this.trayController?.register(this.ipcMain);
    this.nativeFileController?.register(this.ipcMain);
    this.designController?.register(this.ipcMain);
    this.app.on("activate", this.handleActivate);
    this.app.on("window-all-closed", this.handleWindowAllClosed);
    this.logger.info("desktop_application.start_started");
    try {
      await this.app.whenReady();
      await this.windowManager.openPrimaryWindow();
      this.logger.info("desktop_application.start_completed");
    } catch (error) {
      await Promise.allSettled([this.stop()]);
      if (error instanceof ApiTransportError) throw error;
      throw new ApiTransportError(
        "ELECTRON_APPLICATION_START_FAILED",
        true,
        "Electron desktop application failed to start",
      );
    }
  }

  private async stopOnce(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.app.off("activate", this.handleActivate);
    this.app.off("window-all-closed", this.handleWindowAllClosed);
    // Close windows first so the renderer's beforeunload `closeSubscription`
    // invoke is handled while the ipcMain handlers are still registered;
    // disposing the controllers (which remove those handlers) must wait until
    // the renderer is gone, otherwise the invoke hits a removed handler and
    // Electron throws an uncaught exception that crashes the main process.
    const windowResults = await Promise.allSettled([
      this.windowManager.closeAll(),
    ]);
    const results = await Promise.allSettled([
      this.controller.dispose(),
      this.workspaceController?.dispose() ?? Promise.resolve(),
      this.configurationController?.dispose() ?? Promise.resolve(),
      this.windowController?.dispose() ?? Promise.resolve(),
      this.updaterController?.dispose() ?? Promise.resolve(),
      this.trayController?.dispose() ?? Promise.resolve(),
      this.nativeFileController?.dispose() ?? Promise.resolve(),
    ]);
    const failureCount =
      windowResults.filter((result) => result.status === "rejected").length +
      results.filter((result) => result.status === "rejected").length;
    this.logger.info("desktop_application.stop_completed", { failureCount });
    if (failureCount > 0) {
      throw new ApiTransportError(
        "ELECTRON_APPLICATION_STOP_FAILED",
        true,
        "Electron desktop application failed to stop cleanly",
      );
    }
  }

  private readonly handleActivate = (): void => {
    if (this.windowManager.hasWindows()) return;
    void this.windowManager.openWindow().catch(() => {
      this.logger.warn("desktop_application.activate_failed");
    });
  };

  private readonly handleWindowAllClosed = (): void => {
    if (this.platform !== "darwin") this.app.quit();
  };
}
