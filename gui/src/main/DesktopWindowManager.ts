/**
 * Owns secure BrowserWindows and their sender cleanup lifecycle.
 *
 * 多窗口（v0.2）：每个窗口以 webContents.id 为 senderId 注册；菜单命令
 * 分发给聚焦窗口；窗口关闭时释放该 sender 对应的全部 IPC 会话（workspace/
 * configuration/window 等）。DesktopWindowService 按 sender 解析到所属窗口。
 */
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
  on(event: "ready-to-show" | "closed" | "focus", listener: () => void): void;
  loadURL(url: string): Promise<void>;
  loadFile(filePath: string): Promise<void>;
  show(): void;
  close(): void;
  minimize(): void;
  maximize(): void;
  isMaximized(): boolean;
  setAlwaysOnTop(alwaysOnTop: boolean): void;
  setFullscreen(fullscreen: boolean): void;
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
  private readonly windows = new Map<number, DesktopBrowserWindowPort>();
  private readonly cleanupTasks = new Set<Promise<void>>();
  private focusedWindow?: DesktopBrowserWindowPort;

  constructor(options: DesktopWindowManagerOptions) {
    this.options = options;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_window_manager",
    });
  }

  /** 当前是否有至少一个窗口存活（macOS activate 用）。 */
  hasWindows(): boolean {
    return this.windows.size > 0;
  }

  /** 兼容旧名：窗口存在性判断（≥1 窗口）。 */
  hasPrimaryWindow(): boolean {
    return this.hasWindows();
  }

  /**
   * 返回任一窗口实例（向后兼容 DesktopWindowService 的主窗口解析）。
   */
  getPrimaryWindow(): DesktopBrowserWindowPort | undefined {
    return this.windows.values().next().value;
  }

  /** 按 senderId 返回所属窗口（多窗口下窗口操作解析目标）。 */
  getWindowBySender(senderId: number): DesktopBrowserWindowPort | undefined {
    return this.windows.get(senderId);
  }

  /** 返回聚焦窗口；无聚焦或已销毁时退回任一存活窗口。 */
  getFocusedWindow(): DesktopBrowserWindowPort | undefined {
    const focused = this.focusedWindow;
    if (focused !== undefined && !focused.isDestroyed()) return focused;
    return this.getPrimaryWindow();
  }

  ownsSender(senderId: number): boolean {
    return this.windows.has(senderId);
  }

  dispatchCommand(command: ElectronApplicationCommand): boolean {
    const window = this.getFocusedWindow();
    if (window === undefined) return false;
    window.webContents.send(ELECTRON_APPLICATION_COMMAND_CHANNEL, command);
    this.logger.debug("desktop_window.command_dispatched", {
      senderId: window.webContents.id,
      command,
    });
    return true;
  }

  openPrimaryWindow(): Promise<DesktopBrowserWindowPort> {
    return this.openWindow();
  }

  /** 打开一个新窗口（多窗口：每个窗口独立 senderId 与 workspace 会话）。 */
  async openWindow(): Promise<DesktopBrowserWindowPort> {
    const window = this.options.createWindow(
      createSecureWindowOptions(this.options.preloadPath),
    );
    const senderId = validateSenderId(window.webContents.id);
    this.windows.set(senderId, window);
    this.focusedWindow = window;
    this.configureSecurity(window);
    window.on("ready-to-show", () => {
      if (!window.isDestroyed()) window.show();
    });
    window.on("focus", () => {
      this.focusedWindow = window;
    });
    window.on("closed", () => {
      if (this.windows.delete(senderId) && this.focusedWindow === window) {
        this.focusedWindow = undefined;
      }
    });
    window.webContents.on("destroyed", () => {
      if (this.windows.delete(senderId)) {
        if (this.focusedWindow === window) this.focusedWindow = undefined;
        this.trackCleanup(senderId);
      }
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

  async closeAll(): Promise<void> {
    for (const [senderId, window] of [...this.windows.entries()]) {
      this.windows.delete(senderId);
      if (this.focusedWindow === window) this.focusedWindow = undefined;
      this.trackCleanup(senderId);
      if (!window.isDestroyed()) window.close();
    }
    const cleanupTasks = [...this.cleanupTasks];
    await Promise.allSettled(cleanupTasks);
    this.logger.info("desktop_window.close_all_completed", {
      cleanupCount: cleanupTasks.length,
    });
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
    // 隐藏原生 title bar，仅保留 in-app TopBar（spec 5.4 DesktopWindowPort）。
    // macOS 用 hiddenInset 保留 traffic lights 并 inset 内容；其它平台 frame:false
    // 完全无边框，由 DesktopTitleBar 的 minimize/maximize/close 按钮提供窗口控制。
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const }
      : { frame: false as const }),
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
