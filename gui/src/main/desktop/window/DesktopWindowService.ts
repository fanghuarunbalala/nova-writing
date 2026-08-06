/**
 * DesktopWindowService
 *
 * 窗口操作服务（spec 5.4 DesktopWindowPort）。按 senderId 解析所属 BrowserWindow，
 * 向 renderer 暴露 minimize / maximize / close / setAlwaysOnTop / setFullscreen。
 *
 * 设计约束：
 * - 多窗口：优先按 senderId 解析窗口（getWindowBySender）；解析器未实现时退回
 *   getPrimaryWindow（兼容单窗口测试）
 * - 窗口未就绪或已销毁时抛 DesktopWindowError(ELECTRON_WINDOW_NOT_AVAILABLE)，
 *   retryable=true 让 renderer 有机会重试
 * - 不暴露 filesystem / session 等敏感句柄，仅限窗口操作
 *
 * WindowResolver 接口注入便于测试（避免直接依赖 DesktopWindowManager）。
 */
import { noopLogger, type Logger } from "@novel/core";
import type { DesktopBrowserWindowPort } from "../../DesktopWindowManager.js";

/**
 * 窗口解析端口：返回当前可操作的窗口或 undefined。
 * DesktopWindowManager 实现此接口；注入方式便于 service 单测。
 */
export interface DesktopWindowResolver {
  getPrimaryWindow(): DesktopBrowserWindowPort | undefined;
  getWindowBySender?(senderId: number): DesktopBrowserWindowPort | undefined;
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
    const window =
      this.resolver.getWindowBySender?.(senderId) ??
      this.resolver.getPrimaryWindow();
    if (window === undefined) {
      throw new DesktopWindowError(
        "ELECTRON_WINDOW_NOT_AVAILABLE",
        true,
        "Desktop window is not available",
      );
    }
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
