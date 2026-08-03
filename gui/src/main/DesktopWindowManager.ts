/** Owns the secure primary BrowserWindow and its sender cleanup lifecycle. */
import { ApiTransportError, noopLogger, type Logger } from "@novel/core";
import type { BrowserWindowConstructorOptions } from "electron";
import {
  ELECTRON_APPLICATION_COMMAND_CHANNEL,
  type ElectronApplicationCommand,
} from "../shared/index.js";

export type DesktopRendererTarget =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "file"; readonly filePath: string };

export interface DesktopNavigationEventPort {
  preventDefault(): void;
}

export interface DesktopWebContentsPort {
  readonly id: number;
  send(channel: string, value: unknown): void;
  readonly session: {
    setPermissionRequestHandler(
      handler: (
        webContents: unknown,
        permission: string,
        callback: (allowed: boolean) => void,
      ) => void,
    ): void;
  };
  on(
    event: "destroyed",
    listener: () => void,
  ): void;
  on(
    event: "will-navigate",
    listener: (event: DesktopNavigationEventPort, url: string) => void,
  ): void;
  on(
    event: "will-attach-webview",
    listener: (event: DesktopNavigationEventPort) => void,
  ): void;
  setWindowOpenHandler(
    handler: () => { readonly action: "deny" },
  ): void;
}

export interface DesktopBrowserWindowPort {
  readonly webContents: DesktopWebContentsPort;
  on(event: "ready-to-show" | "closed", listener: () => void): void;
  loadURL(url: string): Promise<void>;
  loadFile(filePath: string): Promise<void>;
  show(): void;
  close(): void;
  isDestroyed(): boolean;
}

export interface DesktopWindowManagerOptions {
  readonly preloadPath: string;
  readonly rendererTarget: DesktopRendererTarget;
  readonly createWindow: (
    options: BrowserWindowConstructorOptions,
  ) => DesktopBrowserWindowPort;
  readonly releaseSender: (senderId: number) => Promise<void>;
  readonly isNavigationAllowed?: (url: string) => boolean;
  readonly logger?: Logger;
}

export class DesktopWindowManager {
  private readonly options: DesktopWindowManagerOptions;
  private readonly logger: Logger;
  private readonly senderIds = new Set<number>();
  private readonly cleanupTasks = new Set<Promise<void>>();
  private primaryWindow?: DesktopBrowserWindowPort;
  private openPromise?: Promise<DesktopBrowserWindowPort>;

  constructor(options: DesktopWindowManagerOptions) {
    this.options = options;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_window_manager",
    });
  }

  hasPrimaryWindow(): boolean {
    return this.primaryWindow?.isDestroyed() === false;
  }

  ownsSender(senderId: number): boolean {
    return this.senderIds.has(senderId);
  }

  dispatchCommand(command: ElectronApplicationCommand): boolean {
    const window = this.primaryWindow;
    if (window === undefined || window.isDestroyed()) return false;
    window.webContents.send(ELECTRON_APPLICATION_COMMAND_CHANNEL, command);
    this.logger.debug("desktop_window.command_dispatched", {
      senderId: window.webContents.id,
      command,
    });
    return true;
  }

  openPrimaryWindow(): Promise<DesktopBrowserWindowPort> {
    if (this.primaryWindow?.isDestroyed() === false) {
      return Promise.resolve(this.primaryWindow);
    }
    if (this.openPromise === undefined) {
      const openPromise = this.openPrimaryWindowOnce();
      this.openPromise = openPromise;
      void openPromise.then(
        () => {
          if (this.openPromise === openPromise) this.openPromise = undefined;
        },
        () => {
          if (this.openPromise === openPromise) this.openPromise = undefined;
        },
      );
    }
    return this.openPromise;
  }

  async closeAll(): Promise<void> {
    const window = this.primaryWindow;
    this.primaryWindow = undefined;
    for (const senderId of [...this.senderIds]) {
      this.senderIds.delete(senderId);
      this.trackCleanup(senderId);
    }
    if (window !== undefined && !window.isDestroyed()) window.close();
    const cleanupTasks = [...this.cleanupTasks];
    await Promise.allSettled(cleanupTasks);
    this.logger.info("desktop_window.close_all_completed", {
      cleanupCount: cleanupTasks.length,
    });
  }

  private async openPrimaryWindowOnce(): Promise<DesktopBrowserWindowPort> {
    const window = this.options.createWindow(
      createSecureWindowOptions(this.options.preloadPath),
    );
    const senderId = validateSenderId(window.webContents.id);
    this.primaryWindow = window;
    this.senderIds.add(senderId);
    this.configureSecurity(window);
    window.on("ready-to-show", () => {
      if (!window.isDestroyed()) window.show();
    });
    window.on("closed", () => {
      if (this.primaryWindow === window) this.primaryWindow = undefined;
    });
    window.webContents.on("destroyed", () => {
      if (this.senderIds.delete(senderId)) this.trackCleanup(senderId);
    });
    this.logger.info("desktop_window.open_started", { senderId });
    try {
      if (this.options.rendererTarget.kind === "url") {
        await window.loadURL(this.options.rendererTarget.url);
      } else {
        await window.loadFile(this.options.rendererTarget.filePath);
      }
      this.logger.info("desktop_window.open_completed", { senderId });
      return window;
    } catch {
      if (!window.isDestroyed()) window.close();
      throw new ApiTransportError(
        "ELECTRON_WINDOW_LOAD_FAILED",
        true,
        "Electron desktop window failed to load",
      );
    }
  }

  private configureSecurity(window: DesktopBrowserWindowPort): void {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (this.options.isNavigationAllowed?.(url) !== true) event.preventDefault();
    });
    window.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
  }

  private trackCleanup(senderId: number): void {
    const task = this.options.releaseSender(senderId).catch(() => {
      this.logger.warn("desktop_window.sender_release_failed", { senderId });
    });
    this.cleanupTasks.add(task);
    void task.finally(() => this.cleanupTasks.delete(task));
  }
}

export function createSecureWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  if (preloadPath.trim().length === 0) {
    throw new ApiTransportError(
      "ELECTRON_PRELOAD_PATH_REQUIRED",
      false,
      "Electron Preload path is required",
    );
  }
  if (!preloadPath.endsWith(".cjs")) {
    throw new ApiTransportError(
      "ELECTRON_PRELOAD_BUNDLE_REQUIRED",
      false,
      "Electron Preload must be a bundled CommonJS file",
    );
  }
  return {
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: "#F7F8FA",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      safeDialogs: true,
    },
  };
}

function validateSenderId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ApiTransportError(
      "ELECTRON_WINDOW_SENDER_INVALID",
      false,
      "Electron BrowserWindow sender is invalid",
    );
  }
  return value;
}
