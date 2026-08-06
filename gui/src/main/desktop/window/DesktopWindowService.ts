/**
 * DesktopWindowService
 *
 * 窗口操作服务（spec 5.4 DesktopWindowPort）。包装 DesktopWindowManager 解析出的
 * 主 BrowserWindow，向 renderer 暴露 minimize / maximize / close / setAlwaysOnTop /
 * setFullscreen。
 *
 * 设计约束：
 * - 单窗口应用：DesktopWindowService 始终操作 DesktopWindowManager.getPrimaryWindow()
 *   返回的主窗口；多窗口扩展不在 Phase B.3 范围内
 * - 主窗口未就绪或已销毁时抛 DesktopWindowError(ELECTRON_WINDOW_NOT_AVAILABLE)，
 *   retryable=true 让 renderer 有机会重试
 * - 不暴露 filesystem / session 等敏感句柄，仅限窗口操作
 *
 * WindowResolver 接口注入便于测试（避免直接依赖 DesktopWindowManager）。
 */
import { noopLogger, type Logger } from "@novel/core";
import type { DesktopBrowserWindowPort } from "../../DesktopWindowManager.js";

/**
 * 主窗口解析端口：返回当前可操作的主窗口或 undefined。
 * DesktopWindowManager 实现此接口；注入方式便于 service 单测。
 */
export interface DesktopWindowResolver {
  getPrimaryWindow(): DesktopBrowserWindowPort | undefined;
}

export interface DesktopWindowServiceOptions {
  readonly resolver: DesktopWindowResolver;
  readonly logger?: Logger;
}

export interface DesktopWindowServicePort {
  minimize(senderId: number): Promise<void>;
  maximize(senderId: number): Promise<void>;
  close(senderId: number): Promise<void>;
  setAlwaysOnTop(senderId: number, alwaysOnTop: boolean): Promise<void>;
  setFullscreen(senderId: number, fullscreen: boolean): Promise<void>;
  releaseSender(senderId: number): Promise<void>;
}

export class DesktopWindowService implements DesktopWindowServicePort {
  private readonly resolver: DesktopWindowResolver;
  private readonly logger: Logger;

  constructor(options: DesktopWindowServiceOptions) {
    this.resolver = options.resolver;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_window_service",
    });
  }

  async minimize(senderId: number): Promise<void> {
    const window = this.requireWindow(senderId);
    window.minimize();
    this.logger.debug("desktop_window.minimized", { senderId });
  }

  async maximize(senderId: number): Promise<void> {
    const window = this.requireWindow(senderId);
    if (window.isMaximized()) {
      // 已最大化时调用 maximize 在 Electron 中是 unmaximize 行为，保持语义清晰：
      // 显式调用 maximize() 总是请求"进入最大化"。这里不做幂等恢复，由调用方决策。
    }
    window.maximize();
    this.logger.debug("desktop_window.maximized", { senderId });
  }

  async close(senderId: number): Promise<void> {
    const window = this.requireWindow(senderId);
    window.close();
    this.logger.info("desktop_window.closed", { senderId });
  }

  async setAlwaysOnTop(senderId: number, alwaysOnTop: boolean): Promise<void> {
    const window = this.requireWindow(senderId);
    window.setAlwaysOnTop(alwaysOnTop);
    this.logger.debug("desktop_window.always_on_top_set", { senderId, alwaysOnTop });
  }

  async setFullscreen(senderId: number, fullscreen: boolean): Promise<void> {
    const window = this.requireWindow(senderId);
    window.setFullscreen(fullscreen);
    this.logger.debug("desktop_window.fullscreen_set", { senderId, fullscreen });
  }

  releaseSender(senderId: number): Promise<void> {
    // WindowService 不持有 per-sender 状态；保留接口仅为与其它 service 对齐。
    this.logger.debug("desktop_window.sender_released", { senderId });
    return Promise.resolve();
  }

  private requireWindow(senderId: number): DesktopBrowserWindowPort {
    const window = this.resolver.getPrimaryWindow();
    if (window === undefined) {
      throw new DesktopWindowError(
        "ELECTRON_WINDOW_NOT_AVAILABLE",
        true,
        "Primary desktop window is not available",
      );
    }
    void senderId; // senderId 仅用于日志，service 不做 sender 鉴权（由 IPC controller 负责）
    return window;
  }
}

export class DesktopWindowError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "DesktopWindowError";
  }
}
