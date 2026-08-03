/** Coordinates Electron App lifecycle, secure windows, and the IPC Controller. */
import { ApiTransportError, noopLogger, type ApiTransport, type Logger } from "@novel/core";
import type { BrowserWindowConstructorOptions } from "electron";
import type { ElectronApplicationCommand } from "../shared/index.js";
import { DesktopApiIpcController, type ElectronIpcMainPort } from "./ipc/index.js";
import {
  DesktopWorkspaceIpcController,
  type DesktopWorkspaceServicePort,
} from "./workspace/index.js";
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
}

export class DesktopApplication {
  readonly windowManager: DesktopWindowManager;

  private readonly app: ElectronAppPort;
  private readonly ipcMain: ElectronIpcMainPort;
  private readonly controller: DesktopApiIpcController;
  private readonly workspaceController?: DesktopWorkspaceIpcController;
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
    this.controller = new DesktopApiIpcController({
      ...(options.transport !== undefined ? { transport: options.transport } : {}),
      ...(options.resolveTransport !== undefined
        ? { resolveTransport: options.resolveTransport }
        : {}),
      authorizeSender: (senderId) => windowManager.ownsSender(senderId),
      logger: this.logger,
    });
    this.workspaceController =
      options.workspaceService === undefined
        ? undefined
        : new DesktopWorkspaceIpcController({
            service: options.workspaceService,
            authorizeSender: (senderId) => windowManager.ownsSender(senderId),
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

  private async startOnce(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.controller.register(this.ipcMain);
    this.workspaceController?.register(this.ipcMain);
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
    const results = await Promise.allSettled([
      this.windowManager.closeAll(),
      this.controller.dispose(),
      this.workspaceController?.dispose() ?? Promise.resolve(),
    ]);
    const failureCount = results.filter((result) => result.status === "rejected").length;
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
    if (this.windowManager.hasPrimaryWindow()) return;
    void this.windowManager.openPrimaryWindow().catch(() => {
      this.logger.warn("desktop_application.activate_failed");
    });
  };

  private readonly handleWindowAllClosed = (): void => {
    if (this.platform !== "darwin") this.app.quit();
  };
}
